import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { isResearch, Scribe, SCRIBE_DELAY_MS, SCRIBE_GLINT_MS, type ScribeState } from "../src/scribe.js";

/** A clock the test moves by hand. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => (pending.set(++seq, { at: now + ms, fn }), seq),
      clear: (h: unknown) => void pending.delete(h as number),
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

function scribe() {
  const clock = fakeTimers();
  const shown: ScribeState[] = [];
  return { s: new Scribe((st) => shown.push(st), clock.timers), shown, clock };
}

describe("what counts as research", () => {
  const brain = "/Users/dan/.jarvis/brain";
  it.each([
    ["WebSearch", {}],
    ["WebFetch", { url: "https://example.com" }],
    ["mcp__jarvis__brain_search", { query: "signal" }],
    ["mcp__jarvis__brain_read", { path: "teardowns/signal.md" }],
    ["mcp__rea__inspect_desktop_application", {}],
    ["mcp__rea__analyze_web_bundle", {}],
    ["Read", { file_path: "/Users/dan/.jarvis/brain/teardowns/signal.md" }],
  ])("%s is research", (name, input) => {
    expect(isResearch(name, input, brain)).toBe(true);
  });

  it.each([
    ["mcp__rea__browser_click", {}],
    ["mcp__rea__browser_navigate", {}],
    ["mcp__rea__capture_adb_screen", {}],
    ["mcp__jarvis__brain_save", {}],
    ["Read", { file_path: "/Users/dan/Workspace/jarvis/src/index.ts" }],
    ["Read", { file_path: "/Users/dan/.jarvis/brainstorm.md" }],
    ["Bash", { command: "ls" }],
  ])("%s isn't", (name, input) => {
    expect(isResearch(name, input, brain)).toBe(false);
  });
});

describe("when Thoth rises and sinks", () => {
  it("doesn't rise for a quick lookup", () => {
    const { s, shown, clock } = scribe();
    s.start("a");
    clock.advance(SCRIBE_DELAY_MS - 200);
    s.end("a");
    clock.advance(5_000);
    expect(shown).toEqual([]);
  });

  it("rises once research has lasted 1.5 s, glints when it's done, then sinks", () => {
    const { s, shown, clock } = scribe();
    s.start("a");
    clock.advance(SCRIBE_DELAY_MS);
    expect(shown).toEqual(["researching"]);
    s.end("a");
    expect(shown).toEqual(["researching", "found"]);
    clock.advance(SCRIBE_GLINT_MS);
    expect(shown).toEqual(["researching", "found", null]);
  });

  it("stays up through several lookups in a row, and only glints after the last", () => {
    const { s, shown, clock } = scribe();
    s.start("a");
    s.start("b");
    clock.advance(SCRIBE_DELAY_MS);
    s.end("a");
    expect(shown).toEqual(["researching"]);
    s.end("b");
    s.start("c"); // straight on to the next
    clock.advance(300);
    s.end("c");
    clock.advance(SCRIBE_GLINT_MS);
    expect(shown).toEqual(["researching", "found", "researching", "found", null]);
  });

  it("goes at once when the request ends or is stopped", () => {
    const { s, shown, clock } = scribe();
    s.start("a");
    clock.advance(SCRIBE_DELAY_MS);
    s.reset();
    expect(shown).toEqual(["researching", null]);
    clock.advance(10_000);
    expect(shown).toEqual(["researching", null]);
  });
});

describe("Anubis takes priority over Thoth", () => {
  // A plain browser script (the repo's .js files are ES modules to Node): run in a sandbox with a CommonJS shim.
  const sandbox = { module: { exports: {} as Record<string, unknown> }, globalThis: {} };
  runInNewContext(readFileSync(new URL("../orb/figures.js", import.meta.url), "utf8"), sandbox);
  const { figureTargets } = sandbox.module.exports as {
    figureTargets(s: { guard?: string | null; scribe?: string | null; open?: boolean }): { anubis: number; thoth: number };
  };

  it("Thoth stands behind the orb while she researches", () => {
    expect(figureTargets({ scribe: "researching" })).toEqual({ anubis: 0, thoth: 1 });
  });

  it.each(["checking", "blocked", "voice"])("Thoth steps back while Anubis is %s, and returns after", (guard) => {
    expect(figureTargets({ guard, scribe: "researching" })).toEqual({ anubis: 1, thoth: 0 });
    expect(figureTargets({ guard: null, scribe: "researching" })).toEqual({ anubis: 0, thoth: 1 });
  });

  it("neither shows while the orb is folded away", () => {
    expect(figureTargets({ guard: "blocked", scribe: "researching", open: false })).toEqual({ anubis: 0, thoth: 0 });
  });
});
