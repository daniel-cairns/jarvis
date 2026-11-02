import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../src/tools/sessions.js";
import { buildSessionsView, isShowSessions, messageRule, modeFor, phaseFor, whereLabel, type RunView } from "../src/ui/sessionsPanel.js";
import { isStopCommand, localCommand } from "../src/ui/control.js";
import { parseFromOrb } from "../src/ui/orb.js";

const NOW = Date.parse("2026-11-02T23:00:00Z");
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();
const session = (id: string, status: SessionSummary["status"], minsAgo: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  title: `Session ${id}`,
  project: "hierogitics",
  folder: "/w/hierogitics",
  status,
  lastActivity: ago(minsAgo),
  source: "claude-desktop",
  lastReply: `Reply from ${id}.`,
  lastPrompt: "",
  ...extra,
});
const run = (id: string, status: RunView["status"], extra: Partial<RunView> = {}): RunView => ({
  id,
  label: "jarvis",
  status,
  lastText: `Run ${id} says hi.`,
  startedAt: ago(10),
  ...extra,
});

describe("sessions panel rows", () => {
  it("puts active sessions and running runs first, then waiting on Dan, then idle, newest first in each", () => {
    const { open } = buildSessionsView(
      [session("a", "idle", 5), session("b", "working", 3), session("c", "waiting", 20), session("d", "waiting", 2)],
      [run("s1", "running")],
      NOW,
    );
    expect(open.map((r) => r.run ?? r.ref)).toEqual(["b", "s1", "d", "c", "a"]);
  });

  it("keeps rows where they were on a refresh, so nothing jumps while Dan reads", () => {
    const first = buildSessionsView([session("x", "working", 9), session("y", "working", 1)], [], NOW);
    expect(first.open.map((r) => r.ref)).toEqual(["y", "x"]);
    // x becomes the most recent, but stays put; a newcomer goes to the top of its group.
    const order = first.open.map((r) => r.key);
    const again = buildSessionsView([session("x", "working", 0), session("y", "working", 1), session("z", "working", 5)], [], NOW, new Map(), order);
    expect(again.open.map((r) => r.ref)).toEqual(["z", "y", "x"]);
    // Changing group still moves a row.
    const moved = buildSessionsView([session("x", "working", 0), session("y", "waiting", 1)], [], NOW, new Map(), order);
    expect(moved.open.map((r) => r.ref)).toEqual(["x", "y"]);
  });

  it("shows each session's mode, a run's starting mode, and nothing when it isn't known", () => {
    const view = buildSessionsView(
      [session("a", "working", 1, { permissionMode: "acceptEdits" }), session("b", "idle", 1)],
      [run("s1", "running", { permissionMode: "auto" })],
      NOW,
    );
    const byRef = Object.fromEntries(view.open.map((r) => [r.run ?? r.ref, r.mode]));
    expect(byRef).toEqual({ a: { key: "acceptEdits", label: "Accept edits" }, s1: { key: "auto", label: "Auto" }, b: undefined });
    expect(modeFor("default")).toEqual({ key: "default", label: "Ask" });
    expect(modeFor("nonsense")).toBeUndefined();
  });

  it("marks Astra's background runs apart from Dan's own sessions", () => {
    const view = buildSessionsView([session("a", "waiting", 1)], [run("s1", "running")], NOW);
    expect(view.open.map((r) => [r.run ?? r.ref, r.astra])).toEqual([["s1", true], ["a", false]]);
  });

  it("moves sessions idle for over half an hour to Recent, and drops them after a day", () => {
    const view = buildSessionsView([session("a", "idle", 45), session("b", "idle", 25 * 60)], [], NOW);
    expect(view.open).toHaveLength(0);
    expect(view.recent.map((r) => r.ref)).toEqual(["a"]);
  });

  it("puts finished runs in Recent with their final line", () => {
    const view = buildSessionsView([], [run("s1", "done", { lastText: "All tests pass." })], NOW);
    expect(view.recent[0]).toMatchObject({ status: "done", where: "Background run s1", now: "All tests pass." });
  });

  it("shows a session being driven by a run once, as the run", () => {
    const view = buildSessionsView([session("abc", "working", 1)], [run("s2", "running", { sessionId: "abc" })], NOW);
    expect(view.open).toHaveLength(1);
    expect(view.open[0]).toMatchObject({ run: "s2", ref: "abc", title: "Session abc", canStop: true });
  });

  it("names where each session runs", () => {
    expect(whereLabel("claude-desktop")).toBe("Claude app");
    expect(whereLabel("cli")).toBe("Terminal");
  });

  it("maps statuses to the transcript's glyph rhythms, keeping a run's live tool glyph", () => {
    expect(phaseFor("waiting")).toEqual({ phase: "waiting" });
    expect(phaseFor("working")).toEqual({ phase: "thinking" });
    expect(phaseFor("working", { phase: "tool", glyph: "eye" })).toEqual({ phase: "tool", glyph: "eye" });
    expect(phaseFor("failed")).toEqual({ phase: "failed" });
    const view = buildSessionsView([], [run("s3", "running")], NOW, new Map([["s3", { phase: "tool", glyph: "djed" } as const]]));
    expect(view.open[0]!.state).toEqual({ phase: "tool", glyph: "djed" });
  });
});

describe("sessions panel actions", () => {
  it("only allows a message when the session isn't working, and says why", () => {
    expect(messageRule("idle", true)).toEqual({ canMessage: true });
    expect(messageRule("waiting", true)).toEqual({ canMessage: true });
    expect(messageRule("working", true)).toEqual({ canMessage: false, messageWhy: "It's working; you can message it once it's idle." });
    expect(messageRule("done", false).canMessage).toBe(false);
  });

  it("only offers stop on a running background run", () => {
    const view = buildSessionsView([session("a", "waiting", 1)], [run("s1", "running"), run("s2", "done")], NOW);
    const byRef = Object.fromEntries([...view.open, ...view.recent].map((r) => [r.run ?? r.ref, r.canStop]));
    expect(byRef).toEqual({ a: false, s1: true, s2: false });
  });

  it("accepts only well-formed actions from the panel", () => {
    expect(parseFromOrb(JSON.stringify({ type: "session-action", action: "stop", ref: "abc", run: "s4" }))).toEqual({
      type: "session-action",
      action: "stop",
      ref: "abc",
      run: "s4",
      text: undefined,
    });
    expect(parseFromOrb(JSON.stringify({ type: "session-action", action: "delete", ref: "abc" }))).toBeNull();
    expect(parseFromOrb(JSON.stringify({ type: "session-action", action: "stop", ref: "abc", run: "; rm -rf" }))).toBeNull();
    expect(parseFromOrb(JSON.stringify({ type: "session-action", action: "message", ref: "abc", text: "   " }))).toBeNull();
  });
});

describe("asking for the panel by voice", () => {
  it("opens it for the usual phrasings, without a round trip to Claude", () => {
    for (const said of ["show my sessions", "Astra, show me my open sessions please", "open the sessions panel", "my sessions"]) {
      expect(localCommand(said)).toEqual({ ui: { action: "show_sessions" } });
    }
  });

  it("leaves other session requests to Astra and her session tools", () => {
    expect(isShowSessions("open the hierogitics session")).toBe(false);
    expect(localCommand("message jarvis to run the tests")).toBeNull();
    expect(localCommand("stop s4")).toBeNull();
  });
});

describe("stop by voice", () => {
  it("halts her for a bare stop", () => {
    for (const said of ["Stop.", "stop talking", "cancel that", "never mind", "shush", "stop it now"]) expect(isStopCommand(said)).toBe(true);
  });

  it("lets 'stop <something>' through as a request, so 'stop s4' reaches the session tools", () => {
    for (const said of ["stop s4", "stop the hierogitics run", "stop coffee mode", "cancel the build"]) expect(isStopCommand(said)).toBe(false);
  });
});
