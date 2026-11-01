import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { Jarvis, type JarvisIO } from "../src/agent.js";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("has sensible defaults", () => {
    const cfg = loadConfig({ HOME: "/Users/dan" });
    expect(cfg.model).toBe("claude-opus-5-5");
    expect(cfg.effort).toBe("high");
    expect(cfg.reaCommand).toEqual(["rea", "mcp"]);
    expect(cfg.brainDir.endsWith(path.join(".jarvis", "brain"))).toBe(true);
  });

  it("validates overrides", () => {
    expect(loadConfig({ JARVIS_REA_COMMAND: "node /opt/rea/scripts/rea.mjs mcp" }).reaCommand).toEqual([
      "node",
      "/opt/rea/scripts/rea.mjs",
      "mcp",
    ]);
    expect(() => loadConfig({ JARVIS_EFFORT: "turbo" })).toThrow(/JARVIS_EFFORT/);
    expect(() => loadConfig({ JARVIS_MAX_BUDGET_USD: "-1" })).toThrow(/positive/);
    expect(() => loadConfig({ JARVIS_REA_COMMAND: "  " })).toThrow(/empty/);
  });
});

type Captured = { options?: Options; prompts: string[] };

/** Stands in for the SDK's query(): records options and replays a scripted turn. */
function fakeQuery(script: (opts: Options) => AsyncGenerator<SDKMessage>, captured: Captured) {
  return ((params: { prompt: string; options?: Options }) => {
    captured.options = params.options;
    captured.prompts.push(params.prompt);
    return script(params.options!);
  }) as unknown as typeof import("@anthropic-ai/claude-agent-sdk").query;
}

const msg = (m: Record<string, unknown>) => m as unknown as SDKMessage;

async function setup(answers: string[] = []) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-test-"));
  const cfg = loadConfig({ JARVIS_HOME: home });
  const said: string[] = [];
  const asked: string[] = [];
  const io: JarvisIO = {
    say: async (t) => void said.push(t),
    status: () => {},
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? "no";
    },
  };
  return { home, cfg, io, said, asked };
}

describe("Jarvis", () => {
  it("wires REA and Jarvis tools, speaks top-level text only, and resumes the session", async () => {
    const { home, cfg, io, said } = await setup();
    const captured: Captured = { prompts: [] };
    const jarvis = new Jarvis(
      cfg,
      io,
      fakeQuery(async function* () {
        yield msg({ type: "system", subtype: "init", session_id: "s-1", mcp_servers: [] });
        yield msg({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "On it." }] } });
        yield msg({ type: "assistant", parent_tool_use_id: "t1", message: { content: [{ type: "text", text: "subagent chatter" }] } });
        yield msg({ type: "result", subtype: "success", session_id: "s-1", is_error: false, total_cost_usd: 0.12, result: "Done." });
      }, captured),
    );
    await jarvis.init();

    const first = await jarvis.handle("tear down igloo.inc");
    expect(first).toEqual({ ok: true, costUsd: 0.12, summary: "Done." });
    expect(said).toEqual(["On it."]);
    expect(captured.options?.resume).toBeUndefined();
    expect(captured.options?.model).toBe("claude-opus-5-5");
    expect(captured.options?.mcpServers?.rea).toEqual({ type: "stdio", command: "rea", args: ["mcp"] });
    expect(Object.keys(captured.options?.mcpServers ?? {})).toContain("jarvis");
    expect(captured.options?.cwd).toBe(cfg.workspaceDir);
    await expect(fs.stat(cfg.brainDir)).resolves.toBeTruthy();

    await jarvis.handle("read it to me");
    expect(captured.options?.resume).toBe("s-1");
    jarvis.reset();
    await jarvis.handle("new topic");
    expect(captured.options?.resume).toBeUndefined();
    await fs.rm(home, { recursive: true, force: true });
  });

  it("asks before shell commands and remembers 'always' for the session", async () => {
    const { home, cfg, io, asked } = await setup(["always", "no"]);
    const results: string[] = [];
    const captured: Captured = { prompts: [] };
    const jarvis = new Jarvis(
      cfg,
      io,
      fakeQuery(async function* (opts) {
        const signal = new AbortController().signal;
        for (const [tool, input] of [
          ["Bash", { command: "npm test" }],
          ["Bash", { command: "npm run build" }],
          ["mcp__rea__inspect_web_page", { url: "https://a.b" }],
          ["mcp__jarvis__brain_read", { path: "x.md" }],
        ] as const) {
          const r = await opts.canUseTool!(tool, input, { signal, toolUseID: "t" } as never);
          results.push(r?.behavior ?? "none");
        }
        yield msg({ type: "result", subtype: "success", session_id: "s", is_error: false, total_cost_usd: 0, result: "" });
      }, captured),
    );
    await jarvis.handle("build and test it");
    expect(results).toEqual(["allow", "allow", "deny", "allow"]);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("npm test");
    await fs.rm(home, { recursive: true, force: true });
  });

  it("explains budget stops in plain words", async () => {
    const { home, cfg, io, said } = await setup();
    const jarvis = new Jarvis(
      cfg,
      io,
      fakeQuery(async function* () {
        yield msg({ type: "result", subtype: "error_max_budget_usd", session_id: "s", is_error: true, total_cost_usd: 5.01 });
      }, { prompts: [] }),
    );
    const r = await jarvis.handle("build everything");
    expect(r.ok).toBe(false);
    expect(said[0]).toContain("$5 spending cap");
    await fs.rm(home, { recursive: true, force: true });
  });
});
