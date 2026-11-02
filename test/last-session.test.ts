import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pickLastSession, projectDir, readLastSession, saveLastSession } from "../src/tools/lastSession.js";
import { quickUiCommand } from "../src/ui/control.js";
import { parseFromOrb } from "../src/ui/orb.js";

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});

const ID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const message = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } });

/** A home folder and a projects root holding Astra's conversations for /w/workspace, oldest first. */
function setUp(ids: number[]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "astra-last-"));
  temps.push(base);
  const home = path.join(base, "home");
  const root = path.join(base, "projects");
  const dir = projectDir("/w/workspace", root);
  fs.mkdirSync(dir, { recursive: true });
  ids.forEach((n, i) => {
    const file = path.join(dir, `${ID(n)}.jsonl`);
    fs.writeFileSync(file, `${message}\n`);
    const t = new Date(Date.UTC(2026, 10, 2, 1, i));
    fs.utimesSync(file, t, t);
  });
  return { home, root, dir, workspaceDir: "/w/workspace" };
}

describe("pickLastSession", () => {
  it("picks the conversation recorded before the restart", async () => {
    const s = setUp([1, 2, 3]);
    saveLastSession(s.home, ID(2));
    expect(readLastSession(s.home)).toBe(ID(2));
    expect(await pickLastSession({ ...s })).toMatchObject({ id: ID(2) });
  });

  it("falls back to her newest other conversation, skipping the current one and background runs", async () => {
    const s = setUp([1, 2, 3, 4]);
    // Nothing recorded (the copy that restarted didn't record yet): newest, but not the one she's in now (4)
    // and not a background run (3).
    expect(await pickLastSession({ ...s, current: ID(4), exclude: [ID(3)] })).toMatchObject({ id: ID(2) });
    // A recorded id that's the current conversation doesn't count either.
    saveLastSession(s.home, ID(4));
    expect(await pickLastSession({ ...s, current: ID(4), exclude: [ID(3)] })).toMatchObject({ id: ID(2) });
  });

  it("says plainly when there's nothing to resume, or it's too large or damaged", async () => {
    const empty = setUp([]);
    expect(await pickLastSession(empty)).toEqual({ problem: "I can't find an earlier conversation of mine to pick up." });

    const big = setUp([1]);
    expect(await pickLastSession({ ...big, maxBytes: 10 })).toMatchObject({ problem: expect.stringContaining("too long to pick up") });

    const broken = setUp([1]);
    fs.writeFileSync(path.join(broken.dir, `${ID(1)}.jsonl`), "{not json\n\u0000\u0000");
    expect(await pickLastSession(broken)).toEqual({ problem: "Our last conversation's record looks damaged, so I can't pick it up." });
  });
});

describe("continue last session commands", () => {
  it("recognises the ways of asking", () => {
    for (const said of ["Continue last session.", "pick up where we left off", "resume our previous conversation", "carry on with the last session"]) {
      expect(quickUiCommand(said)).toEqual({ action: "continue_session" });
    }
    expect(quickUiCommand("continue the gymclaw session")).toBeNull();
    expect(parseFromOrb('{"type":"continue-session"}')).toEqual({ type: "continue-session" });
  });
});
