import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "../src/config.js";
import { SessionRunner, sessionEnv, type Job } from "../src/tools/runner.js";
import { appLinks, listSessions, resolveProject, summarise } from "../src/tools/sessions.js";

const ID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const line = (o: object) => JSON.stringify(o);
const assistant = (text: string, stop: string) => ({ type: "assistant", message: { content: [{ type: "text", text }], stop_reason: stop } });

describe("summarise", () => {
  const head = [{ type: "user", cwd: "/w/gymclaw", entrypoint: "claude-desktop", message: { content: "fix the login" } }];
  it("reads title, project, latest reply and status", () => {
    const tail = [{ type: "custom-title", customTitle: "Login fixes" }, assistant("Done: tests pass.", "end_turn")];
    const s = summarise(ID(1), head, tail, new Date(Date.now() - 60_000));
    expect(s).toMatchObject({ title: "Login fixes", project: "gymclaw", folder: "/w/gymclaw", source: "claude-desktop", status: "waiting", lastReply: "Done: tests pass." });
  });

  it("is working when recently active mid-turn, idle when old", () => {
    const working = [assistant("Running the tests.", "tool_use"), { type: "user", message: { content: [{ type: "tool_result" }] } }];
    expect(summarise(ID(1), head, working, new Date()).status).toBe("working");
    expect(summarise(ID(1), head, working, new Date(Date.now() - 24 * 3600_000)).status).toBe("idle");
  });
});

describe("listSessions, resolveProject and links", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sessions-"));
    for (const [dir, id, cwd, title] of [
      ["-w-gymclaw", ID(1), "/w/gymclaw", "Login fixes"],
      ["-w-astra", ID(2), "/home/.jarvis/workspace", "Astra's own"],
    ] as const) {
      await fs.mkdir(path.join(root, dir), { recursive: true });
      await fs.writeFile(
        path.join(root, dir, `${id}.jsonl`),
        [line({ type: "user", cwd, message: { content: "hi" } }), line({ type: "custom-title", customTitle: title }), line(assistant("ok", "end_turn"))].join("\n"),
      );
    }
    await fs.writeFile(path.join(root, "-w-gymclaw", "not-a-session.jsonl"), "{}");
  });
  afterEach(async () => fs.rm(root, { recursive: true, force: true }));

  it("lists sessions, filters by project, and can leave out Astra's own", async () => {
    expect((await listSessions({ root })).map((s) => s.title).sort()).toEqual(["Astra's own", "Login fixes"]);
    expect((await listSessions({ root, project: "gym" })).map((s) => s.title)).toEqual(["Login fixes"]);
    expect((await listSessions({ root, exclude: ["/home/.jarvis/workspace"] })).map((s) => s.title)).toEqual(["Login fixes"]);
  });

  it("matches spoken project names to folders", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "home-"));
    await fs.mkdir(path.join(home, "Workspace", "buje-budget-app"), { recursive: true });
    await fs.mkdir(path.join(home, "Workspace", "gymclaw"), { recursive: true });
    expect(await resolveProject("gym claw", [], home)).toBe(path.join(home, "Workspace", "gymclaw"));
    expect(await resolveProject("budget app", [], home)).toBe(path.join(home, "Workspace", "buje-budget-app"));
    expect(await resolveProject("nothing like it", [], home)).toBeNull();
    await fs.rm(home, { recursive: true, force: true });
  });

  it("builds the Claude app's links", () => {
    expect(appLinks.open({ id: ID(1), source: "claude-desktop" })).toBe(`claude://code/continue?session=${ID(1)}`);
    expect(appLinks.open({ id: ID(1), source: "sdk-ts" })).toBe(`claude://resume?session=${ID(1)}`);
    expect(appLinks.newSession("/w/gymclaw", "fix it")).toBe("claude://code/new?folder=%2Fw%2Fgymclaw&q=fix+it&source=desktop_action");
  });
});

describe("sessionEnv", () => {
  it("drops the inherited desktop entrypoint so Astra's runs aren't labelled as app sessions", () => {
    expect(sessionEnv({ PATH: "/bin", CLAUDE_CODE_ENTRYPOINT: "claude-desktop", EMPTY: undefined })).toEqual({ PATH: "/bin" });
  });
});

describe("SessionRunner", () => {
  it("runs in the background, relays approvals, reports progress and the result", async () => {
    const seen: string[] = [];
    let options: Record<string, unknown> = {};
    const fakeQuery = (async function* ({ options: o }: { options: Record<string, unknown> }) {
      options = o;
      yield { type: "system", subtype: "init", session_id: ID(9) } as unknown as SDKMessage;
      yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } } as unknown as SDKMessage;
      const allowed = await (o.canUseTool as (n: string, i: object, x: object) => Promise<{ behavior: string }>)("Bash", { command: "npm test" }, {});
      seen.push(`permission:${allowed.behavior}`);
      yield { type: "result", subtype: "success", session_id: ID(9), is_error: false, total_cost_usd: 0.12, result: "All 12 tests pass." } as unknown as SDKMessage;
    }) as never;
    const finished = new Promise<Job>((resolve) => {
      const runner = new SessionRunner(loadConfig({}), {
        activity: (_j, tool) => seen.push(`activity:${tool}`),
        ask: async (_j, a) => (seen.push(`ask:${a.detail}`), "yes"),
        finished: resolve,
      }, fakeQuery);
      const job = runner.send(ID(9), "/w/gymclaw", "run the tests", "gymclaw");
      expect(job.id).toBe("s1");
    });
    const job = await finished;
    expect(options).toMatchObject({ cwd: "/w/gymclaw", resume: ID(9) });
    // Background runs get the same page-fetch security check as Astra.
    const hooks = options.hooks as Record<string, { matcher: string }[]>;
    expect(hooks.PreToolUse?.[0]?.matcher).toBe("WebFetch");
    expect(hooks.PostToolUse?.[0]?.matcher).toBe("WebFetch");
    expect(seen).toEqual(["activity:Bash", "ask:gymclaw session: I'd like to run the command: npm test.", "permission:allow"]);
    expect(job).toMatchObject({ status: "done", sessionId: ID(9), lastText: "All 12 tests pass.", costUsd: 0.12 });
  });
});
