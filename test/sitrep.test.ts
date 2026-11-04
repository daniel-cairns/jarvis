import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../src/tools/sessions.js";
import { newlyWaiting, sitrep } from "../src/tools/sitrep.js";

const now = Date.UTC(2026, 10, 2, 12, 0, 0);
const at = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
const session = (id: string, title: string, status: SessionSummary["status"], minsAgo: number, lastReply = ""): SessionSummary => ({
  id,
  title,
  project: "super-potato",
  folder: "/w/super-potato",
  status,
  lastActivity: at(minsAgo),
  source: "claude-desktop",
  lastReply,
  lastPrompt: "",
});

describe("sitrep", () => {
  it("says who is working and who is waiting, and lists them by group", () => {
    const report = sitrep(
      [
        session("1", "Character movement", "working", 1),
        session("2", "Character creation", "waiting", 5, "Which potato should I brief? I'd pick Tahdig."),
        session("3", "Menu creation", "idle", 300),
        session("4", "Old thing", "idle", 3 * 24 * 60),
      ],
      [{ handle: "s1", label: "cosmetics", status: "running", latest: "Painting take 12 of 36." }],
      now,
    );
    expect(report.spoken).toBe(
      "One session is working: Character movement. One is waiting on you: Character creation. I'm running cosmetics in the background.",
    );
    expect(report.markdown).toContain("## ❓ Waiting on you\n\n- **Character creation** · super-potato · 5 min ago\n  Which potato should I brief?");
    expect(report.markdown).toContain("**cosmetics** (s1) · running");
    expect(report.markdown).toContain("Menu creation");
    expect(report.markdown).not.toContain("Old thing");
  });

  it("names at most three per group out loud", () => {
    const many = ["A", "B", "C", "D", "E"].map((t, i) => session(String(i), t, "waiting", 10));
    expect(sitrep(many, [], now).spoken).toBe("Five are waiting on you: A, B, C and two more.");
  });

  it("says all quiet when nothing needs anyone", () => {
    expect(sitrep([session("3", "Menu creation", "idle", 30)], [], now).spoken).toBe("All quiet: nothing is working or waiting on you.");
  });
});

describe("newlyWaiting", () => {
  it("finds sessions that just finished a turn", () => {
    const before = new Map<string, SessionSummary["status"]>([["1", "working"], ["2", "waiting"]]);
    const found = newlyWaiting(before, [session("1", "A", "waiting", 0), session("2", "B", "waiting", 0), session("3", "C", "waiting", 0)]);
    expect(found.map((s) => s.title)).toEqual(["A"]);
  });
});

describe("FinishWatcher: god mode doesn't announce the session Dan is in", () => {
  const at = Date.parse("2026-11-04T08:00:00Z");
  const s = (id: string, status: "working" | "waiting" | "idle") => session(id, `Session ${id}`, status, 0);

  it("announces a session once it has been left waiting two minutes, and only once", async () => {
    const { FinishWatcher } = await import("../src/tools/sitrep.js");
    const w = new FinishWatcher();
    expect(w.update([s("a", "working")], at)).toEqual([]);
    expect(w.update([s("a", "waiting")], at + 30_000)).toEqual([]);
    expect(w.update([s("a", "waiting")], at + 90_000)).toEqual([]);
    expect(w.update([s("a", "waiting")], at + 150_000).map((x) => x.id)).toEqual(["a"]);
    expect(w.update([s("a", "waiting")], at + 180_000)).toEqual([]);
  });

  it("never announces one Dan answers within the two minutes (the one he's sitting in)", async () => {
    const { FinishWatcher } = await import("../src/tools/sitrep.js");
    const w = new FinishWatcher();
    w.update([s("me", "working")], at);
    for (let turn = 0; turn < 5; turn++) {
      const t = at + turn * 120_000;
      expect(w.update([s("me", "waiting")], t + 30_000)).toEqual([]);
      expect(w.update([s("me", "working")], t + 60_000)).toEqual([]);
    }
  });

  it("doesn't announce what was already waiting when god mode was turned on", async () => {
    const { FinishWatcher } = await import("../src/tools/sitrep.js");
    const w = new FinishWatcher();
    w.update([s("old", "waiting")], at);
    expect(w.update([s("old", "waiting")], at + 10 * 60_000)).toEqual([]);
  });
});
