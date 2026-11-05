import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { Loop } from "../src/loops.js";
import type { SessionSummary } from "../src/tools/sessions.js";
import { FINISHED_RUN_MS, GOD_GLYPHS, godSlate, SLATE_MAX } from "../src/ui/godSlate.js";
import { parseFromOrb } from "../src/ui/orb.js";
import { buildSessionsView, type RunView } from "../src/ui/sessionsPanel.js";

// A plain browser script (the repo's .js files are ES modules to Node): run in a sandbox with a CommonJS shim.
const sandbox = { module: { exports: {} as Record<string, unknown> }, globalThis: {} };
runInNewContext(readFileSync(new URL("../orb/god-glyphs.js", import.meta.url), "utf8"), sandbox);
type Entry = { key: string; glyph: string; onSlate: boolean; needs: string };
const page = sandbox.module.exports as {
  GLYPHS: Record<string, { label: string; strokes: string[] }>;
  slateSide(orbCentreX: number, areaX: number, areaWidth: number): "left" | "right";
  needsDan(entry: { needs: string }): boolean;
  notableChanges(previous: Map<string, string> | null, entries: Entry[]): Entry[];
  slateWing(o: { width: number; rootY: number; lift: number; rootHalf: number; tipHalf: number; hug?: { x: number; y: number; r: number } }): {
    band: string;
    centreY(x: number): number;
    top(x: number): number;
    bottom(x: number): number;
    rootX(y: number): number;
  };
};

const NOW = Date.parse("2026-11-04T09:00:00Z");
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();
const session = (id: string, status: SessionSummary["status"], minsAgo: number): SessionSummary => ({
  id,
  title: `Session ${id}`,
  project: "budget-app",
  folder: "/w/budget-app",
  status,
  lastActivity: ago(minsAgo),
  source: "claude-desktop",
  lastReply: `Reply from ${id}.`,
  lastPrompt: "",
});
const run = (id: string, status: RunView["status"], extra: Partial<RunView> = {}): RunView => ({
  id,
  label: "jarvis",
  status,
  lastText: `Run ${id} says hi.`,
  startedAt: ago(10),
  ...extra,
});
const decision = (id: string, text: string, minsAgo: number, extra: Partial<Loop> = {}): Loop => ({ id, kind: "decision", text, openedAt: ago(minsAgo), ...extra });
const slate = (sessions: SessionSummary[], runs: RunView[] = [], loops: Loop[] = [], phases = new Map()) =>
  godSlate(buildSessionsView(sessions, runs, NOW, phases), loops, NOW, new Map([["s1", "Running a command: npm test"]]));

describe("God mode: real data to glyphs", () => {
  it("gives each of Dan's sessions its status glyph and a satellite: working water, waiting eye, idle reed", () => {
    const entries = slate([session("a", "working", 1), session("b", "waiting", 2), session("c", "idle", 3)]);
    expect(entries.map((e) => [e.ref, e.glyph, e.satellite])).toEqual([
      ["a", "working", "working"],
      ["b", "waiting", "waiting"],
      ["c", "idle", "idle"],
    ]);
    expect(entries.find((e) => e.ref === "b")).toMatchObject({ meaning: "Waiting on you", summary: "Reply from b." });
    expect(entries.find((e) => e.ref === "b")!.needs).not.toMatch(/^Nothing/);
    expect(entries.find((e) => e.ref === "a")!.needs).toMatch(/^Nothing/);
  });

  it("shows her background runs as the bird while running, the eye while asking, then the ankh or broken staff", () => {
    const running = slate([], [run("s1", "running", { sessionId: "x1" })]);
    expect(running[0]).toMatchObject({ glyph: "background", meaning: "Background run", satellite: "working", ref: "x1", lastAction: "Running a command: npm test" });

    const asking = slate([], [run("s1", "running")], [], new Map([["s1", { phase: "waiting" }]]));
    expect(asking[0]).toMatchObject({ glyph: "waiting", satellite: "waiting" });
    expect(asking[0]!.ref).toBeUndefined(); // no session yet, so nothing to open

    const ended = slate([], [run("s2", "done", { endedAt: ago(5) }), run("s3", "failed", { endedAt: ago(6) }), run("s4", "stopped", { endedAt: ago(7) })]);
    expect(ended.map((e) => [e.glyph, e.meaning, e.satellite])).toEqual([
      ["done", "Done", undefined],
      ["failed", "Failed", undefined],
      ["failed", "Stopped", undefined],
    ]);
    expect(ended[1]!.needs).not.toMatch(/^Nothing/);
  });

  it("drops runs that finished more than a couple of hours ago", () => {
    const old = new Date(NOW - FINISHED_RUN_MS - 60_000).toISOString();
    expect(slate([], [run("s2", "done", { endedAt: old, startedAt: old })])).toEqual([]);
  });

  it("puts an open decision on the slate as the eye, with nothing to open and no satellite", () => {
    const entry = slate([], [], [decision("l1", "Ship 2.4 today?", 3, { source: "Release notes" }), decision("l2", "Old one", 9, { closedAt: ago(1) })])[0]!;
    expect(entry).toMatchObject({ key: "loop:l1", glyph: "waiting", title: "Release notes", status: "decision", summary: "Ship 2.4 today?" });
    expect(entry.ref).toBeUndefined();
    expect(entry.satellite).toBeUndefined();
    expect(entry.needs).toBe("A decision: Ship 2.4 today?");
    // Run and "later" loops aren't decisions: runs are shown as themselves, and later items aren't on the slate.
    expect(slate([], [], [{ id: "l3", kind: "later", text: "Book the dentist", openedAt: ago(1) }])).toEqual([]);
  });

  it("keeps the slate to a handful, newest first, never dropping what needs Dan", () => {
    const sessions = Array.from({ length: 10 }, (_, i) => session(`w${i}`, "working", i + 1));
    const entries = slate([...sessions, session("old", "waiting", 25)]);
    const shown = entries.filter((e) => e.onSlate);
    expect(shown).toHaveLength(SLATE_MAX);
    expect(shown.some((e) => e.ref === "old")).toBe(true);
    // Every commanded session still orbits her, on the slate or not.
    expect(entries.filter((e) => e.satellite)).toHaveLength(11);
    const at = shown.map((e) => e.at);
    expect(at).toEqual([...at].sort((a, b) => b - a));
  });

  it("only ever uses the fixed glyph set, the same one the orb draws", () => {
    expect(Object.keys(page.GLYPHS).sort()).toEqual([...GOD_GLYPHS].sort());
    const entries = slate([session("a", "working", 1), session("b", "waiting", 2), session("c", "idle", 3)], [run("s2", "done", { endedAt: ago(1) })], [decision("l1", "Q?", 1)]);
    for (const e of entries) expect(GOD_GLYPHS).toContain(e.glyph);
  });
});

describe("the slate opens towards the middle of the screen", () => {
  it("opens to her left on the right half of the screen, and to her right on the left half", () => {
    expect(page.slateSide(1700, 0, 1920)).toBe("left");
    expect(page.slateSide(200, 0, 1920)).toBe("right");
    expect(page.slateSide(960, 0, 1920)).toBe("left");
  });

  it("measures against the orb's own display, wherever it is", () => {
    // A second display to the left of the main one, from -1440 to 0.
    expect(page.slateSide(-1300, -1440, 1440)).toBe("right");
    expect(page.slateSide(-100, -1440, 1440)).toBe("left");
  });
});

describe("what's news on the slate", () => {
  const entry = (key: string, glyph: string, onSlate = true): Entry => ({ key, glyph, onSlate, needs: "Nothing" });

  it("never counts the first update after God mode turns on", () => {
    expect(page.notableChanges(null, [entry("a", "waiting")])).toEqual([]);
  });

  it("counts entries newly waiting, done or failed, but not ones merely working or idle", () => {
    const previous = new Map([["a", "working"], ["b", "waiting"], ["c", "idle"]]);
    const fresh = page.notableChanges(previous, [entry("a", "waiting"), entry("b", "waiting"), entry("c", "working"), entry("d", "done"), entry("e", "failed", false)]);
    expect(fresh.map((e) => e.key)).toEqual(["a", "d"]);
  });

  it("reads 'Nothing…' as needing nothing from Dan", () => {
    expect(page.needsDan({ needs: "Nothing yet" })).toBe(false);
    expect(page.needsDan({ needs: "A decision: ship it?" })).toBe(true);
  });
});

describe("opening from a satellite or cartouche reuses the sessions panel's message", () => {
  it("lets a well-formed open through", () => {
    expect(parseFromOrb('{"type":"session-action","action":"open","ref":"9f0c1e2a-0000-4000-8000-000000000001"}')).toEqual({
      type: "session-action",
      action: "open",
      ref: "9f0c1e2a-0000-4000-8000-000000000001",
      run: undefined,
      text: undefined,
    });
  });

  it("drops anything else: unknown actions, missing or overlong refs, and the page's own slate-room", () => {
    expect(parseFromOrb('{"type":"session-action","action":"delete","ref":"a"}')).toBeNull();
    expect(parseFromOrb('{"type":"session-action","action":"open"}')).toBeNull();
    expect(parseFromOrb(JSON.stringify({ type: "session-action", action: "open", ref: "x".repeat(200) }))).toBeNull();
    expect(parseFromOrb('{"type":"session-action","action":"open","ref":"a","run":"rm -rf"}')).toBeNull();
    expect(parseFromOrb('{"type":"slate-room","side":"left","width":300}')).toBeNull();
  });
});

describe("the slate's wing", () => {
  // As god.js draws it: cartouches 36 px tall plus a 2 px tie-bar 4 px under them, 24 px below their centre.
  // Her lower wings' path: radius 131 round her centre, which sits 8 px above the slate and left of its foot.
  const root = Math.sqrt(131 ** 2 - 92 ** 2);
  const wing = page.slateWing({ width: 194, rootY: 56, lift: 22, rootHalf: 28, tipHalf: 26, hug: { x: -root, y: -8, r: 131 } });

  it("is tall enough for a whole cartouche and its tie-bar all along", () => {
    for (const x of [0, 50, 120, 194]) {
      const centre = wing.centreY(x);
      expect(wing.bottom(x) - centre).toBeGreaterThan(24);
      expect(centre - wing.top(x)).toBeGreaterThan(18);
      expect(wing.top(x)).toBeGreaterThan(6); // room for the covert feathers above it
    }
  });

  it("lays its root edge on her lower wings' path: on that circle round her, its foot at x = 0", () => {
    expect(wing.rootX(84)).toBeCloseTo(0, 5);
    for (const y of [28, 42, 56, 70, 84]) expect(Math.hypot(wing.rootX(y) + root, y + 8)).toBeCloseTo(131, 5);
    expect(wing.rootX(28)).toBeGreaterThan(wing.rootX(56)); // further out at the top, as the circle curves round her
  });

  it("keeps a straight root without hug", () => {
    expect(page.slateWing({ width: 100, rootY: 50, lift: 10, rootHalf: 20, tipHalf: 18 }).rootX(50)).toBe(0);
  });
});
