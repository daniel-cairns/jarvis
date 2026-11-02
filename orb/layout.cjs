// Where Astra's panels go, so you can see every open one at once: pure layout maths (no Electron), applied by
// main.cjs whenever a panel opens, closes, folds or resizes, the orb moves, or a display changes.
//
// The whole work area is used, with the orb as a fixed obstacle. The space around the orb is split into regions
// (left and right of it full height with strips above and below it, or above and below it full width with strips
// beside it; whichever works better), the panels are shared between the regions, and each region is tiled into
// columns of stacked panels. Panels shrink towards content-aware minimums before anything overlaps. Only when even
// the minimums can't fit do panels in a column overlap, by as little as possible, and never so far that a panel's
// header (its title and close button) is covered. Every rect stays inside the work area and clear of the orb.

const GAP = 10;
const MARGIN = 12;
/** The height of a panel's header strip (title, status line, close): never covered by another panel. */
const HEADER = 64;
/** The smallest each panel can usefully be, by kind: enough for its content to still read. */
const MINS = {
  transcript: [300, 200],
  terminal: [360, 180],
  git: [340, 200],
  detail: [360, 240],
  graph: [420, 300],
  brain: [440, 320],
};
const DEFAULT_MIN = [320, 200];
// Kept for main.cjs and older callers: the smallest minimums of all.
const MIN_WIDTH = Math.min(...Object.values(MINS).map((m) => m[0]));
const MIN_HEIGHT = Math.min(...Object.values(MINS).map((m) => m[1]));
const INFEASIBLE = 1e15;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ kind: string, width: number, height: number, folded?: boolean, lastUsed?: number,
 *   minWidth?: number, minHeight?: number }} Panel
 *   width/height: the size it wants; folded: only its header shows, so its height is fixed.
 * @param {{ area: Rect, orb: Rect, panels: Panel[], exhaustive?: boolean }} input
 *   exhaustive: try every way of sharing the panels between regions (slow; tests use it to check the search).
 * @returns {{ rects: Record<string, Rect>, order: string[], overlap: number }}
 *   order: the stacking order to apply, bottom first; overlap: total overlapping area in px².
 */
function layoutPanels({ area, orb, panels, exhaustive = false }) {
  if (!panels.length) return { rects: {}, order: [], overlap: 0 };
  const inner = { x: area.x + MARGIN, y: area.y + MARGIN, width: area.width - 2 * MARGIN, height: area.height - 2 * MARGIN };
  const items = panels.map((p) => {
    const [mw, mh] = MINS[p.kind] ?? DEFAULT_MIN;
    const minW = Math.min(p.minWidth ?? mw, inner.width);
    const minH = p.folded ? p.height : Math.min(p.minHeight ?? mh, inner.height);
    return { ...p, minW, minH, wantW: Math.max(p.width, minW), wantH: p.folded ? p.height : Math.max(p.height, minH) };
  });

  let best = null;
  for (const regions of partitions(inner, orb)) {
    const usable = regions.filter((r) => r.width > 0 && r.height > 0);
    if (!usable.length) continue;
    const found = exhaustive ? searchAll(usable, items) : searchLocal(usable, items);
    if (!best || better(found.cost, best.cost)) best = found;
  }
  if (!best || best.cost.overlap >= INFEASIBLE) return fallback(inner, items);

  const rects = {};
  for (const [kind, r] of Object.entries(best.rects)) rects[kind] = r;
  // Lower panels go on top, so where a column overlaps, the header of the one above stays visible.
  const order = Object.keys(rects).sort((a, b) => rects[a].y - rects[b].y);
  return { rects, order, overlap: best.cost.overlap };
}

/** The two ways to split the space around the orb into non-overlapping regions. */
function partitions(inner, orb) {
  const right = inner.x + inner.width;
  const bottom = inner.y + inner.height;
  const ox0 = Math.max(inner.x, orb.x);
  const ox1 = Math.min(right, orb.x + orb.width);
  const oy0 = Math.max(inner.y, orb.y);
  const oy1 = Math.min(bottom, orb.y + orb.height);
  const box = (x0, y0, x1, y1) => ({ x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) });
  const leftEdge = ox0 - GAP;
  const rightEdge = ox1 + GAP;
  const topEdge = oy0 - GAP;
  const bottomEdge = oy1 + GAP;
  return [
    // Columns: full height either side, strips above and below the orb.
    [
      box(inner.x, inner.y, leftEdge, bottom),
      box(rightEdge, inner.y, right, bottom),
      box(ox0, inner.y, ox1, topEdge),
      box(ox0, bottomEdge, ox1, bottom),
    ],
    // Rows: full width above and below, strips either side of the orb.
    [
      box(inner.x, inner.y, right, topEdge),
      box(inner.x, bottomEdge, right, bottom),
      box(inner.x, oy0, leftEdge, oy1),
      box(rightEdge, oy0, right, oy1),
    ],
  ].map((regions) => regions.map((r) => ({ ...r, towardOrbRight: r.x + r.width <= orb.x })));
}

/** Less overlap wins; then the better fit to the sizes the panels want. */
const better = (a, b) => (a.overlap !== b.overlap ? a.overlap < b.overlap : a.fit > b.fit + 1e-9);

/** The rects and cost of a given sharing of panels between regions (assign[i] = region index of items[i]). */
function evaluate(regions, items, assign) {
  const rects = {};
  let overlap = 0;
  let fit = 0;
  for (let r = 0; r < regions.length; r++) {
    const mine = items.filter((_, i) => assign[i] === r);
    if (!mine.length) continue;
    const tiled = tileRegion(regions[r], mine);
    if (!tiled) return { rects, cost: { overlap: INFEASIBLE, fit: 0 } };
    overlap += tiled.overlap;
    fit += tiled.fit;
    Object.assign(rects, tiled.rects);
  }
  return { rects, cost: { overlap, fit } };
}

/** Greedy start (biggest panels to the emptiest region), then single moves and swaps until nothing improves. */
function searchLocal(regions, items) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].wantW * items[b].wantH - items[a].wantW * items[a].wantH);
  const load = regions.map(() => 0);
  const assign = new Array(items.length).fill(0);
  for (const i of order) {
    const it = items[i];
    let pick = -1;
    let pickScore = Infinity;
    regions.forEach((reg, r) => {
      if (reg.width < it.minW || reg.height < it.minH) return;
      const score = (load[r] + it.wantW * it.wantH) / (reg.width * reg.height);
      if (score < pickScore) [pick, pickScore] = [r, score];
    });
    if (pick < 0) pick = regions.reduce((m, reg, r) => (reg.width * reg.height > regions[m].width * regions[m].height ? r : m), 0);
    assign[i] = pick;
    load[pick] += it.wantW * it.wantH;
  }
  let best = evaluate(regions, items, assign);
  for (let pass = 0, improved = true; improved && pass < 30; pass++) {
    improved = false;
    for (let i = 0; i < items.length; i++) {
      for (let r = 0; r < regions.length; r++) {
        if (assign[i] === r) continue;
        const was = assign[i];
        assign[i] = r;
        const tried = evaluate(regions, items, assign);
        if (better(tried.cost, best.cost)) [best, improved] = [tried, true];
        else assign[i] = was;
      }
      for (let j = i + 1; j < items.length; j++) {
        if (assign[i] === assign[j]) continue;
        [assign[i], assign[j]] = [assign[j], assign[i]];
        const tried = evaluate(regions, items, assign);
        if (better(tried.cost, best.cost)) [best, improved] = [tried, true];
        else [assign[i], assign[j]] = [assign[j], assign[i]];
      }
    }
  }
  return best;
}

/** Every sharing of panels between regions (regions^panels of them): the true best, for checking searchLocal. */
function searchAll(regions, items) {
  const assign = new Array(items.length).fill(0);
  let best = null;
  const total = regions.length ** items.length;
  for (let n = 0; n < total; n++) {
    for (let i = 0, v = n; i < items.length; i++, v = Math.floor(v / regions.length)) assign[i] = v % regions.length;
    const tried = evaluate(regions, items, assign);
    if (!best || better(tried.cost, best.cost)) best = tried;
  }
  return best;
}

/**
 * Tiles one region with columns of stacked panels, trying every column count. Null if the panels can't go there
 * at all (too narrow, or too many headers to show in the height).
 */
function tileRegion(region, items) {
  let best = null;
  for (let cols = 1; cols <= items.length; cols++) {
    const colW = Math.floor((region.width - GAP * (cols - 1)) / cols);
    // Tallest first, each into the column with the least height so far.
    const columns = Array.from({ length: cols }, () => ({ items: [], height: 0 }));
    for (const it of [...items].sort((a, b) => b.wantH - a.wantH)) {
      const col = columns.reduce((m, c) => (c.height < m.height ? c : m));
      col.items.push(it);
      col.height += it.wantH;
    }
    if (columns.some((c) => !c.items.length || c.items.some((it) => it.minW > colW))) continue;
    const rects = {};
    let overlap = 0;
    let fit = 0;
    let ok = true;
    columns.forEach((c, k) => {
      const x = region.x + k * (colW + GAP);
      const stacked = stackColumn({ x, y: region.y, width: colW, height: region.height }, c.items, region.towardOrbRight);
      if (!stacked) return void (ok = false);
      overlap += stacked.overlap;
      fit += stacked.fit;
      Object.assign(rects, stacked.rects);
    });
    if (!ok) continue;
    const tiled = { rects, overlap, fit };
    if (!best || better(tiled, best)) best = tiled;
  }
  return best;
}

/**
 * One column: panels at the size they want if they fit, otherwise shrunk towards their minimums, and only then
 * overlapped (evenly, keeping every header visible). Null if even that can't show every header.
 */
function stackColumn(col, items, alignRight) {
  const n = items.length;
  const gaps = GAP * (n - 1);
  const widthOf = (it) => Math.min(it.wantW, col.width);
  const xOf = (w) => (alignRight ? col.x + col.width - w : col.x);
  let heights;
  let shifts = new Array(Math.max(0, n - 1)).fill(0);
  const sumMin = items.reduce((s, it) => s + it.minH, 0);
  if (sumMinFits(items, col) === false) return null;
  if (n === 1) {
    heights = [Math.min(items[0].wantH, col.height)];
  } else if (sumMin + gaps <= col.height) {
    heights = fitHeights(items, col.height - gaps);
  } else {
    // Overlap is unavoidable here: minimum heights, and the excess shared evenly between the joins, each limited
    // so the panel underneath keeps its header (water-filling).
    // Shortest first, so each panel ends no lower than the next and the last one ends at the bottom: nothing is cut off.
    items = [...items].sort((a, b) => a.minH - b.minH);
    heights = items.map((it) => it.minH);
    let excess = sumMin + gaps - col.height;
    const caps = items.slice(0, -1).map((it) => Math.max(0, it.minH + GAP - (it.folded ? it.minH + GAP : HEADER)));
    if (caps.reduce((s, c) => s + c, 0) < excess) return null;
    let open = caps.map((c, j) => j).filter((j) => caps[j] > 0);
    while (excess > 0.5 && open.length) {
      const share = excess / open.length;
      for (const j of open) {
        const take = Math.min(share, caps[j] - shifts[j]);
        shifts[j] += take;
        excess -= take;
      }
      open = open.filter((j) => caps[j] - shifts[j] > 0.5);
    }
    shifts = shifts.map((s) => Math.ceil(s));
  }
  const rects = {};
  let overlap = 0;
  let fit = 0;
  let y = col.y;
  items.forEach((it, i) => {
    const w = widthOf(it);
    const h = Math.min(heights[i], col.y + col.height - y);
    rects[it.kind] = { x: xOf(w), y, width: w, height: h };
    if (!it.folded) fit += Math.min(1, w / it.wantW) * Math.min(1, h / it.wantH);
    if (i < n - 1) y += heights[i] + GAP - shifts[i];
  });
  const placed = items.map((it) => rects[it.kind]);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) overlap += overlapArea(placed[i], placed[j]);
  return { rects, overlap, fit };
}

const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** A column must at least hold each of its panels at minimum height on its own. */
const sumMinFits = (items, col) => items.every((it) => it.minH <= col.height);

/** Heights sharing `room`: their own if they fit, otherwise shrunk by one factor, none below its minimum. */
function fitHeights(items, room) {
  const heights = items.map((it) => it.wantH);
  let atMin = new Set(items.map((it, i) => (it.folded ? i : -1)).filter((i) => i >= 0));
  for (let pass = 0; pass <= items.length; pass++) {
    const free = items.map((_, i) => i).filter((i) => !atMin.has(i));
    const held = [...atMin].reduce((s, i) => s + items[i].minH, 0);
    const want = free.reduce((s, i) => s + items[i].wantH, 0);
    const scale = want > room - held ? Math.max(0, room - held) / want : 1;
    const next = new Set(atMin);
    for (const i of free) {
      const h = Math.floor(items[i].wantH * scale);
      if (h < items[i].minH) next.add(i);
      heights[i] = Math.max(h, items[i].minH);
    }
    for (const i of atMin) heights[i] = items[i].minH;
    if (next.size === atMin.size) break;
    atMin = next;
  }
  return heights;
}

/** Nowhere sensible at all (a tiny screen): minimum sizes, staggered by a header so every title still shows. */
function fallback(inner, items) {
  const rects = {};
  items.forEach((it, i) => {
    const width = Math.min(it.minW, inner.width);
    const height = Math.min(it.minH, inner.height);
    const step = Math.max(0, Math.min(HEADER, (inner.height - height) / Math.max(1, items.length - 1)));
    rects[it.kind] = { x: inner.x + Math.min(i * 24, inner.width - width), y: inner.y + i * step, width, height };
  });
  const order = items.map((it) => it.kind);
  return { rects, order, overlap: Infinity };
}

/** The minimum size of a panel of this kind. */
const minFor = (kind) => MINS[kind] ?? DEFAULT_MIN;

module.exports = { layoutPanels, minFor, MIN_WIDTH, MIN_HEIGHT, GAP, HEADER };
