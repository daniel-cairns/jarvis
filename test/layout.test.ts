import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Rect = { x: number; y: number; width: number; height: number };
type Panel = { kind: string; width: number; height: number; folded?: boolean; lastUsed?: number };
const { layoutPanels, MIN_WIDTH, MIN_HEIGHT } = createRequire(import.meta.url)("../orb/layout.cjs") as {
  layoutPanels(i: { area: Rect; orb: Rect; panels: Panel[] }): { rects: Record<string, Rect>; cascaded: string[] };
  MIN_WIDTH: number;
  MIN_HEIGHT: number;
};

// The panels' own default sizes (orb/main.cjs).
const SIZES: Record<string, [number, number]> = {
  detail: [540, 620],
  graph: [880, 640],
  brain: [920, 660],
  terminal: [600, 330],
  git: [600, 420],
  transcript: [380, 560],
};
const panels = (...kinds: string[]): Panel[] => kinds.map((kind, i) => ({ kind, width: SIZES[kind]![0], height: SIZES[kind]![1], lastUsed: i }));

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (r: Rect, area: Rect) => r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height;

/** No two laid-out panels (cascaded ones aside) overlap each other or the orb, and every panel is inside the area. */
function expectTidy(area: Rect, orb: Rect, out: ReturnType<typeof layoutPanels>) {
  const placed = Object.entries(out.rects);
  for (const [kind, r] of placed) {
    expect(inside(r, area), `${kind} inside the work area`).toBe(true);
    if (!out.cascaded.includes(kind)) expect(overlaps(r, orb), `${kind} clear of the orb`).toBe(false);
  }
  const tiled = placed.filter(([k]) => !out.cascaded.includes(k));
  for (let i = 0; i < tiled.length; i++)
    for (let j = i + 1; j < tiled.length; j++) expect(overlaps(tiled[i]![1], tiled[j]![1]), `${tiled[i]![0]} vs ${tiled[j]![0]}`).toBe(false);
}

// A big external display and a 13" laptop (work areas below the menu bar, above the Dock), orb on the right.
const big = { x: 0, y: 25, width: 2560, height: 1350 };
const laptop = { x: 0, y: 25, width: 1440, height: 820 };
const orbOn = (area: Rect): Rect => ({ x: area.x + area.width - 340, y: area.y + 300, width: 320, height: 420 });

describe("layoutPanels", () => {
  it("puts one panel beside the orb at its own size", () => {
    const orb = orbOn(big);
    const out = layoutPanels({ area: big, orb, panels: panels("detail") });
    expect(out.rects.detail).toMatchObject({ width: 540, height: 620 });
    expect(out.rects.detail!.x + 540).toBeLessThanOrEqual(orb.x);
    expectTidy(big, orb, out);
  });

  it("lays every kind of panel out without overlaps on a big display", () => {
    const orb = orbOn(big);
    const out = layoutPanels({ area: big, orb, panels: panels("detail", "graph", "brain", "terminal", "git", "transcript") });
    expect(out.cascaded).toEqual([]);
    expectTidy(big, orb, out);
    // The work panels share the column nearest the orb.
    const nearest = Math.max(...Object.values(out.rects).map((r) => r.x + r.width));
    expect(out.rects.transcript!.x + out.rects.transcript!.width).toBe(nearest);
  });

  it("fits them on a laptop by shrinking to minimum sizes, and cascades only what can't fit", () => {
    const orb = orbOn(laptop);
    const out = layoutPanels({ area: laptop, orb, panels: panels("detail", "graph", "brain", "terminal", "git", "transcript") });
    expectTidy(laptop, orb, out);
    for (const [kind, r] of Object.entries(out.rects)) {
      expect(r.width, kind).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(r.height, kind).toBeGreaterThanOrEqual(MIN_HEIGHT);
    }
    // The most recently used are the ones kept in the layout; the oldest cascade.
    expect(out.cascaded).not.toContain("transcript");
    expect(out.cascaded.length).toBeLessThan(6);
  });

  it("keeps a folded panel's height and stacks it with the rest", () => {
    const orb = orbOn(big);
    const ps = panels("terminal", "git", "transcript");
    ps[0]!.folded = true;
    ps[0]!.height = 60;
    const out = layoutPanels({ area: big, orb, panels: ps });
    expect(out.rects.terminal!.height).toBe(60);
    expectTidy(big, orb, out);
  });

  it("goes to the right when the orb is on the left", () => {
    const orb = { x: 20, y: 300, width: 320, height: 420 };
    const out = layoutPanels({ area: big, orb, panels: panels("detail", "transcript") });
    for (const r of Object.values(out.rects)) expect(r.x).toBeGreaterThan(orb.x + orb.width);
    expectTidy(big, orb, out);
  });

  it("keeps everything on screen even when the screen is tiny", () => {
    const tiny = { x: 0, y: 25, width: 800, height: 500 };
    const orb = { x: 470, y: 50, width: 320, height: 420 };
    const out = layoutPanels({ area: tiny, orb, panels: panels("detail", "graph", "brain", "terminal") });
    for (const [kind, r] of Object.entries(out.rects)) expect(inside(r, tiny), kind).toBe(true);
    expect(Object.keys(out.rects).sort()).toEqual(["brain", "detail", "graph", "terminal"]);
  });
});
