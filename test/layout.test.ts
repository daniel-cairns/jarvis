import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Rect = { x: number; y: number; width: number; height: number };
type Panel = { kind: string; width: number; height: number; folded?: boolean; lastUsed?: number };
type Layout = { rects: Record<string, Rect>; order: string[]; overlap: number };
const { layoutPanels, minFor, HEADER } = createRequire(import.meta.url)("../orb/layout.cjs") as {
  layoutPanels(i: { area: Rect; orb: Rect; panels: Panel[]; exhaustive?: boolean }): Layout;
  minFor(kind: string): [number, number];
  HEADER: number;
};

// The panels' own default sizes (orb/main.cjs), plus two more of an unknown kind to reach eight.
const SIZES: Record<string, [number, number]> = {
  detail: [540, 620],
  graph: [880, 640],
  brain: [920, 660],
  terminal: [600, 330],
  git: [600, 420],
  transcript: [380, 560],
  extra1: [500, 400],
  extra2: [500, 400],
};
const ALL = Object.keys(SIZES);
const panels = (...kinds: string[]): Panel[] => kinds.map((kind, i) => ({ kind, width: SIZES[kind]![0], height: SIZES[kind]![1], lastUsed: i }));

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const inside = (r: Rect, area: Rect) => r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height;
const totalOverlap = (rects: Rect[]) => {
  let sum = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) sum += overlapArea(rects[i]!, rects[j]!);
  return sum;
};

/** Every panel inside the work area, clear of the orb, at least its minimum size, and with its header uncovered. */
function expectSound(area: Rect, orb: Rect, out: Layout, kinds: string[]) {
  expect(Object.keys(out.rects).sort()).toEqual([...kinds].sort());
  for (const [kind, r] of Object.entries(out.rects)) {
    expect(inside(r, area), `${kind} inside the work area`).toBe(true);
    expect(overlapArea(r, orb), `${kind} clear of the orb`).toBe(0);
    expect(r.width, `${kind} width`).toBeGreaterThanOrEqual(minFor(kind)[0]);
    expect(r.height, `${kind} height`).toBeGreaterThanOrEqual(minFor(kind)[1]);
  }
  // Nothing stacked above a panel (later in the order) covers its header strip.
  out.order.forEach((kind, i) => {
    const r = out.rects[kind]!;
    const header = { ...r, height: HEADER };
    for (const above of out.order.slice(i + 1)) expect(overlapArea(header, out.rects[above]!), `${kind}'s header under ${above}`).toBe(0);
  });
  expect(totalOverlap(Object.values(out.rects))).toBe(out.overlap);
}

// Work areas (below the menu bar, above the Dock) of a 13" laptop and a 27" display, orb on the right.
const laptop = { x: 0, y: 25, width: 1440, height: 820 };
const big = { x: 0, y: 25, width: 2560, height: 1350 };
const orbOn = (area: Rect): Rect => ({ x: area.x + area.width - 340, y: area.y + 300, width: 320, height: 420 });

describe("layoutPanels v2: every open panel visible at once", () => {
  for (const [name, area] of [["27-inch", big], ["13-inch", laptop]] as const) {
    for (let n = 1; n <= 8; n++) {
      it(`fits ${n} panel${n > 1 ? "s" : ""} on a ${name} screen with no overlap`, () => {
        const orb = orbOn(area);
        const kinds = ALL.slice(0, n);
        const out = layoutPanels({ area, orb, panels: panels(...kinds) });
        expectSound(area, orb, out, kinds);
        // No overlap whenever the minimums allow it; where they don't, as little as any sharing of the space gives.
        // (Zero is already the best, so the slow exhaustive check only runs when there is overlap.)
        if (out.overlap > 0) expect(out.overlap).toBeLessThanOrEqual(layoutPanels({ area, orb, panels: panels(...kinds), exhaustive: true }).overlap);
        if (area === big || n < 8) expect(out.overlap).toBe(0);
      });
    }
  }

  it("uses the space above and below the orb, not just the side with more room", () => {
    // Orb in the middle: panels end up on both sides of it.
    const orb = { x: 1120, y: 465, width: 320, height: 420 };
    const out = layoutPanels({ area: big, orb, panels: panels(...ALL) });
    const xs = Object.values(out.rects).map((r) => r.x);
    expect(xs.some((x) => x < orb.x)).toBe(true);
    expect(xs.some((x) => x > orb.x + orb.width)).toBe(true);
    expectSound(big, orb, out, ALL);
  });

  it("gives one panel the size it wants, beside the orb", () => {
    const orb = orbOn(big);
    const out = layoutPanels({ area: big, orb, panels: panels("detail") });
    expect(out.rects.detail).toMatchObject({ width: 540, height: 620 });
  });

  it("shrinks panels towards their minimums before it overlaps any", () => {
    const small = { x: 0, y: 25, width: 1280, height: 700 };
    const orb = orbOn(small);
    const out = layoutPanels({ area: small, orb, panels: panels(...ALL.slice(0, 5)) });
    expectSound(small, orb, out, ALL.slice(0, 5));
    expect(out.overlap).toBe(0);
    const shrunk = Object.entries(out.rects).some(([k, r]) => r.width < SIZES[k]![0] || r.height < SIZES[k]![1]);
    expect(shrunk).toBe(true);
  });

  it("keeps a folded panel's header height", () => {
    const orb = orbOn(big);
    const ps = panels("terminal", "git", "transcript");
    ps[0]!.folded = true;
    ps[0]!.height = 60;
    const out = layoutPanels({ area: big, orb, panels: ps });
    expect(out.rects.terminal!.height).toBe(60);
  });

  it("overlaps as little as possible when it can't be avoided, and never hides a header", () => {
    const tiny = { x: 0, y: 25, width: 1100, height: 640 };
    const orb = orbOn(tiny);
    const kinds = ALL.slice(0, 7);
    const out = layoutPanels({ area: tiny, orb, panels: panels(...kinds) });
    expectSound(tiny, orb, out, kinds);
    expect(out.overlap).toBeGreaterThan(0);
    // The quick search finds as little overlap as trying every way of sharing the panels out.
    const best = layoutPanels({ area: tiny, orb, panels: panels(...kinds), exhaustive: true });
    expect(out.overlap).toBeLessThanOrEqual(best.overlap);
  });

});
