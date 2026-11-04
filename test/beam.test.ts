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

describe("the beam follows where she's working", () => {
  it("after she opens Chrome, aims at Chrome's window (not the app that was in front before), and goes when the request ends", async () => {
    const { ComputerControl } = await import("../src/control/computer.js");
    let front = 100; // Dan's editor, in front before she acts
    const helper = async (command: string, input?: any) => {
      if (command === "perms") return { accessibility: true, screenRecording: true };
      if (command === "front") return { pid: front };
      if (command === "activate") {
        front = 200; // opening Chrome brings it forward
        return { pid: 200 };
      }
      if (command === "windows")
        return [
          { pid: 200, frame: { X: 50, Y: 40, Width: 1000, Height: 700 } },
          { pid: 100, frame: { X: 0, Y: 25, Width: 1440, Height: 875 } },
        ];
      return { ok: true, input };
    };
    const beams: unknown[] = [];
    const indicator: boolean[] = [];
    const c = new ComputerControl(helper, {
      confirm: async () => true,
      log: () => {},
      indicator: (on) => indicator.push(on),
      open: async () => {},
      beam: (t) => beams.push(t),
    });
    await c.openApp("Google Chrome");
    await new Promise((r) => setTimeout(r, 10));
    expect(beams.at(-1)).toEqual({ x: 50, y: 40, width: 1000, height: 700 });
    expect(indicator.at(-1)).toBe(true);
    c.done();
    expect(indicator.at(-1)).toBe(false);
    expect(beams.at(-1)).toBeNull();
  });
});
