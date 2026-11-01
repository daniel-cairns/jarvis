import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Box = { x: number; y: number; width: number; height: number };
const { stackLayout } = createRequire(import.meta.url)("../orb/stack.cjs") as {
  stackLayout(area: Box, orb: Box, panels: { kind: string; width: number; height: number }[]): Record<string, Box>;
};

const area = { x: 0, y: 25, width: 1728, height: 1080 };
const orbRight = { x: 1380, y: 300, width: 320, height: 420 };

describe("stackLayout", () => {
  it("stacks panels in a column beside the orb, on the side with more room", () => {
    const out = stackLayout(area, orbRight, [
      { kind: "detail", width: 540, height: 620 },
      { kind: "terminal", width: 600, height: 330 },
    ]);
    expect(out.detail).toEqual({ x: 1380 - 10 - 600, y: 37, width: 600, height: 620 });
    expect(out.terminal).toEqual({ x: 770, y: 37 + 620 + 10, width: 600, height: 330 });
  });

  it("starts a new column, further out, when the next panel doesn't fit underneath", () => {
    const out = stackLayout(area, orbRight, [
      { kind: "detail", width: 540, height: 620 },
      { kind: "brain", width: 920, height: 660 },
    ]);
    expect(out.detail!.x + out.detail!.width).toBe(1380 - 10);
    expect(out.brain!.y).toBe(37);
    expect(out.brain!.x + out.brain!.width).toBe(out.detail!.x - 10);
    expect(out.brain!.x).toBeGreaterThanOrEqual(12);
  });

  it("goes right when the orb is on the left, and narrows columns that don't fit", () => {
    const orbLeft = { x: 20, y: 300, width: 320, height: 420 };
    const out = stackLayout({ ...area, width: 1280 }, orbLeft, [
      { kind: "graph", width: 880, height: 640 },
      { kind: "brain", width: 920, height: 660 },
    ]);
    expect(out.graph!.x).toBe(350);
    expect(out.graph!.width + out.brain!.width + 10).toBeLessThanOrEqual(1280 - 340 - 12 - 10);
  });
});
