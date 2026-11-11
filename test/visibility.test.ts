import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { parseFromOrb } from "../src/ui/orb.js";
import { frontReport, shownReport, type PanelVisibility } from "../src/ui/visibility.js";

const { visibilityOf } = createRequire(import.meta.url)("../orb/visibility.cjs") as {
  visibilityOf(w: unknown[], pid: number, b: { x: number; y: number; width: number; height: number }): PanelVisibility & { coveredBy: string[] };
};

const ASTRA = 4242;
const detail = { x: 300, y: 200, width: 540, height: 620 };
const win = (app: string, pid: number, X: number, Y: number, Width: number, Height: number) => ({ app, pid, frame: { X, Y, Width, Height } });

describe("is the panel really on screen? (from the window list, front to back)", () => {
  it("behind a maximised Chrome: covered, which is what happened on 4 Nov", () => {
    const list = [win("Google Chrome", 1, 0, 25, 1710, 1082), win("Electron", ASTRA, 300, 200, 540, 620)];
    expect(visibilityOf(list, ASTRA, detail)).toEqual({ onScreen: true, covered: true, coveredBy: ["Google Chrome"] });
  });

  it("in front of Chrome: shown", () => {
    const list = [win("Electron", ASTRA, 300, 200, 540, 620), win("Google Chrome", 1, 0, 25, 1710, 1082)];
    expect(visibilityOf(list, ASTRA, detail)).toMatchObject({ onScreen: true, covered: false });
  });

  it("half under another window still counts as shown", () => {
    const list = [win("Notes", 2, 0, 0, 570, 1100), win("Electron", ASTRA, 300, 200, 540, 620)];
    expect(visibilityOf(list, ASTRA, detail)).toMatchObject({ onScreen: true, covered: false });
  });

  it("not in the list at all (closed, or never appeared): not on screen", () => {
    expect(visibilityOf([win("Google Chrome", 1, 0, 25, 1710, 1082)], ASTRA, detail)).toMatchObject({ onScreen: false });
  });
});

describe("what she says about it: never \"Shown\" when it isn't", () => {
  const ok: PanelVisibility = { kind: "detail", onScreen: true, covered: false, coveredBy: [] };

  it("says Shown only when it really is", () => {
    expect(shownReport("detail", "Shown in the detail panel.", ok)).toBe("Shown in the detail panel.");
  });

  it("says when it's covered, and by what", () => {
    const r = shownReport("detail", "Shown in the detail panel.", { ...ok, covered: true, coveredBy: ["Google Chrome"] });
    expect(r).toBe("I opened the detail panel, but Google Chrome is covering it, so Dan can't see it.");
    expect(r).not.toMatch(/^Shown/);
  });

  it("says when it isn't on screen, and when it couldn't check", () => {
    expect(shownReport("brain", "Opened the brain browser with 40 notes.", { ...ok, kind: "brain", onScreen: false })).toMatch(/isn't on screen/);
    expect(shownReport("detail", "Shown in the detail panel.", null)).toMatch(/couldn't check/);
  });

  it("bringing panels forward reports the ones still hidden", () => {
    expect(frontReport([ok, { ...ok, kind: "sessions" }])).toBe("Brought my panels to the front.");
    expect(frontReport([ok, { kind: "tallyline", onScreen: true, covered: true, coveredBy: ["Google Chrome"] }])).toBe(
      "Brought 1 of my 2 panels forward, but the Tallyline panel is covered by Google Chrome.",
    );
    expect(frontReport([{ kind: "sessions", onScreen: false, covered: false, coveredBy: [] }])).toMatch(/^I couldn't bring my panels forward: the sessions panel isn't on screen/);
    expect(frontReport([])).toBe("No panels are open.");
    expect(frontReport(null)).toMatch(/couldn't check/);
  });
});

describe("the orb's reports are read safely", () => {
  it("parses a panel-shown report, and drops one that's malformed", () => {
    expect(parseFromOrb(JSON.stringify({ type: "panel-shown", kind: "detail", result: { kind: "detail", onScreen: true, covered: false, coveredBy: [] } }))).toEqual({
      type: "panel-shown",
      kind: "detail",
      result: { kind: "detail", onScreen: true, covered: false, coveredBy: [] },
    });
    expect(parseFromOrb(JSON.stringify({ type: "panel-shown", kind: "detail", result: { onScreen: "yes" } }))).toEqual({ type: "panel-shown", kind: "detail", result: null });
  });
});
