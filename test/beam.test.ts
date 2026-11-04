import { describe, expect, it } from "vitest";
import { beamTarget } from "../src/control/computer.js";

describe("beamTarget: the window her beam points at", () => {
  const windows = [
    { pid: 99, frame: { X: 1200, Y: 0, Width: 30, Height: 22 } }, // a menu-bar sliver of the same app
    { pid: 42, frame: { X: 0, Y: 25, Width: 1440, Height: 875 } }, // another app, in front
    { pid: 99, frame: { X: 120, Y: 80, Width: 900, Height: 640 } }, // the app she's working in, front window
    { pid: 99, frame: { X: 300, Y: 200, Width: 800, Height: 600 } }, // its window behind
  ];

  it("picks the front real window of the app she's working in", () => {
    expect(beamTarget(windows, 99)).toEqual({ x: 120, y: 80, width: 900, height: 640 });
  });

  it("is null when that app has no window on screen", () => {
    expect(beamTarget(windows, 7)).toBeNull();
    expect(beamTarget([{ pid: 7 }], 7)).toBeNull();
  });
});
