import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// A plain browser script (the repo's .js files are ES modules to Node): run in a sandbox with a CommonJS shim.
const sandbox = { module: { exports: {} as Record<string, unknown> }, globalThis: {} };
runInNewContext(readFileSync(new URL("../orb/wing-tips.js", import.meta.url), "utf8"), sandbox);
type Rect = { left: number; top: number; width: number; height: number };
const { tipFor, placeTip, GAP, MARGIN } = sandbox.module.exports as {
  tipFor(id: string, state?: { disabled?: boolean; pressed?: boolean; expanded?: boolean }): { text: string; keys?: string; note?: string } | null;
  placeTip(p: { anchor: Rect; size: { width: number; height: number }; viewport: { width: number; height: number } }): { left: number; top: number; where: string };
  GAP: number;
  MARGIN: number;
};

describe("help text on her lower wings", () => {
  it("names every wing button, with Esc for stop and for folding the slate", () => {
    for (const id of ["stop", "record", "type-only", "minimise", "front", "eye"]) expect(tipFor(id)?.text).toBeTruthy();
    expect(tipFor("stop")).toMatchObject({ text: "Stop Astra", keys: "Esc" });
    expect(tipFor("eye", { expanded: true })).toMatchObject({ text: "Fold the slate", keys: "Esc" });
    expect(tipFor("eye", { expanded: false })?.keys).toBeUndefined();
    expect(tipFor("talk")).toBeNull();
  });

  it("follows the button's state", () => {
    expect(tipFor("record", { pressed: true })?.text).toBe("Stop the transcript");
    expect(tipFor("record", { pressed: false })?.text).toBe("Record a transcript");
    expect(tipFor("type-only", { pressed: true })?.text).toMatch(/^Back to voice/);
    expect(tipFor("stop", { disabled: true })?.text).toMatch(/nothing to stop/);
  });

  const viewport = { width: 430, height: 350 };
  const size = { width: 120, height: 24 };

  it("goes centred above its button when there's room", () => {
    const at = placeTip({ anchor: { left: 140, top: 260, width: 26, height: 26 }, size, viewport });
    expect(at).toEqual({ left: 140 + 13 - 60, top: 260 - GAP - 24, where: "above" });
  });

  it("stays inside the window at the sides", () => {
    expect(placeTip({ anchor: { left: 2, top: 200, width: 26, height: 26 }, size, viewport }).left).toBe(MARGIN);
    expect(placeTip({ anchor: { left: 410, top: 200, width: 26, height: 26 }, size, viewport }).left).toBe(430 - MARGIN - 120);
  });

  it("flips below near the top, and beside when neither fits", () => {
    expect(placeTip({ anchor: { left: 200, top: 10, width: 26, height: 26 }, size, viewport }).where).toBe("below");
    const tall = { width: 120, height: 200 };
    const beside = placeTip({ anchor: { left: 100, top: 150, width: 26, height: 26 }, size: tall, viewport });
    expect(beside.where).toBe("right");
    expect(beside.top).toBeGreaterThanOrEqual(MARGIN);
    expect(beside.top + tall.height).toBeLessThanOrEqual(viewport.height - MARGIN);
    expect(placeTip({ anchor: { left: 380, top: 150, width: 26, height: 26 }, size: tall, viewport }).where).toBe("left");
  });
});
