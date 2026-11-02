import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// A plain browser script (Node treats the repo's .js as ES modules), run in a sandbox with a CommonJS shim.
const sandbox = { module: { exports: {} as Record<string, unknown> }, globalThis: {} };
runInNewContext(readFileSync(new URL("../orb/dial.js", import.meta.url), "utf8"), sandbox);
const { chevronLit, locksFor } = sandbox.module.exports as {
  chevronLit(c: number, locked: number, chevrons: number): boolean;
  locksFor(chevrons: number): number;
};

const litAfter = (locked: number) => Array.from({ length: 9 }, (_, c) => c).filter((c) => chevronLit(c, locked, 9));

describe("stargate dial chevrons", () => {
  it("lights mirror pairs from the top down, both sides together", () => {
    expect(locksFor(9)).toBe(4);
    expect(litAfter(0)).toEqual([]);
    expect(litAfter(1)).toEqual([1, 8]);
    expect(litAfter(2)).toEqual([1, 2, 7, 8]);
    expect(litAfter(3)).toEqual([1, 2, 3, 6, 7, 8]);
  });

  it("lights every chevron, left side included, once the dial completes", () => {
    expect(litAfter(4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // The left half (5 to 8) lights as early as the right half (1 to 4), pair by pair.
    for (let locked = 1; locked <= 4; locked++) {
      const lit = litAfter(locked);
      expect(lit.filter((c) => c >= 5).length).toBe(lit.filter((c) => c >= 1 && c <= 4).length);
    }
  });
});
