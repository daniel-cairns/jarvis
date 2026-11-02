import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/** Loads a browser script that also exports for CommonJS. */
function load<T>(file: string): T {
  const module = { exports: {} as T };
  vm.runInNewContext(readFileSync(new URL(`../orb/${file}`, import.meta.url), "utf8"), { module });
  return module.exports;
}

type Frame = { name: string; dim: boolean }[];
const runes = load<{ RING: string[]; TICK: Record<string, number>; LABEL: Record<string, string>; frame(s: unknown, t: number): Frame }>("runes.js");
const glyphs = load<{ names: string[]; RING_NAMES: string[]; svg(n: string, c?: string): string }>("glyphs.js");

describe("transcript state glyphs", () => {
  it("rolls while thinking, so frames change", () => {
    const a = runes.frame({ phase: "thinking" }, 0).map((g) => g.name).join();
    const b = runes.frame({ phase: "thinking" }, 1).map((g) => g.name).join();
    expect(a).not.toBe(b);
  });

  it("holds the tool's own glyph in the centre while the rest flip", () => {
    for (let t = 0; t < 12; t++) expect(runes.frame({ phase: "tool", glyph: "eye" }, t)[2]).toEqual({ name: "eye", dim: false });
    const sides = new Set(Array.from({ length: 6 }, (_, t) => runes.frame({ phase: "tool", glyph: "eye" }, t)[0]!.name));
    expect(sides.size).toBeGreaterThan(1);
  });

  it("settles and stops when the run ends", () => {
    for (const phase of ["done", "failed", "stopped"]) {
      expect(runes.TICK[phase]).toBe(0);
      expect(runes.frame({ phase }, 0)).toEqual(runes.frame({ phase }, 9));
    }
  });

  it("only ever shows ring glyphs, five at a time, with a label for every state", () => {
    for (const phase of Object.keys(runes.TICK)) {
      const f = runes.frame({ phase, glyph: "djed" }, 3);
      expect(f).toHaveLength(5);
      for (const g of f) expect(runes.RING).toContain(g.name);
      expect(runes.LABEL[phase]).toBeTruthy();
    }
  });
});

describe("glyph set", () => {
  it("has the six ring glyphs plus both coffee-mode candidates, all hidden from screen readers", () => {
    expect(glyphs.RING_NAMES).toEqual(["ankh", "eye", "water", "djed", "sun", "reed"]);
    expect(glyphs.names).toEqual(expect.arrayContaining(["clepsydra", "aten"]));
    for (const n of glyphs.names) expect(glyphs.svg(n)).toMatch(/aria-hidden="true"/);
  });

  it("stills every animation for reduced motion", () => {
    const css = readFileSync(new URL("../orb/glyph.css", import.meta.url), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*g-drop[\s\S]*g-rays[\s\S]*animation: none/);
    const panel = readFileSync(new URL("../orb/transcript.js", import.meta.url), "utf8");
    expect(panel).toMatch(/reduced\.matches\) return/);
  });
});
