import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// A plain browser script (the repo's .js files are ES modules to Node): run in a sandbox with a CommonJS shim.
const sandbox = { module: { exports: {} as Record<string, unknown> }, globalThis: {} };
runInNewContext(readFileSync(new URL("../orb/hit.js", import.meta.url), "utf8"), sandbox);
const { isSolid, SOLID_ALPHA } = sandbox.module.exports as { isSolid(p: { target: string; alpha?: number }): boolean; SOLID_ALPHA: number };

describe("her click area is the shape of her body", () => {
  it("takes clicks on her controls and cards, and on drawn pixels of the orb", () => {
    expect(isSolid({ target: "control" })).toBe(true);
    expect(isSolid({ target: "canvas", alpha: 255 })).toBe(true);
    expect(isSolid({ target: "canvas", alpha: SOLID_ALPHA })).toBe(true);
  });

  it("lets clicks through her faint glow and the empty window", () => {
    expect(isSolid({ target: "canvas", alpha: SOLID_ALPHA - 1 })).toBe(false);
    expect(isSolid({ target: "canvas", alpha: 0 })).toBe(false);
    expect(isSolid({ target: "empty" })).toBe(false);
  });
});
