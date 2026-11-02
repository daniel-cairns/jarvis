// Where Astra's panels go, so they never overlap: pure layout maths (no Electron), applied by main.cjs whenever a
// panel opens, closes, folds or resizes, the orb moves, or a display changes.
//
// The orb stays put. Panels go on whichever side of it has more room: a column right beside the orb for the narrow
// "work" panels (transcript, terminal, git), and the rest of that side for the big ones (detail, map, brain): one
// fills it, two split it, three or more tile. Short of room, panels shrink to their minimum size, then the least
// recently used ones cascade inside the area. Every rect stays inside the work area, so nothing is unreachable.

const GAP = 10;
const MARGIN = 12;
const MIN_WIDTH = 340;
const MIN_HEIGHT = 220;
const CASCADE_STEP = 28;
const SIDE_KINDS = new Set(["transcript", "terminal", "git"]);

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ kind: string, width: number, height: number, folded?: boolean, lastUsed?: number }} Panel
 *   width/height: the size it wants; folded: only its header shows, so its height is fixed; lastUsed: newest = largest.
 * @param {{ area: Rect, orb: Rect, panels: Panel[] }} input
 * @returns {{ rects: Record<string, Rect>, cascaded: string[] }}
 */
function layoutPanels({ area, orb, panels }) {
  const rects = {};
  const cascaded = [];
  if (!panels.length) return { rects, cascaded };

  // The side of the orb with more room (the whole area if neither side can take a panel).
  const top = area.y + MARGIN;
  const height = area.height - 2 * MARGIN;
  const roomLeft = orb.x - GAP - (area.x + MARGIN);
  const roomRight = area.x + area.width - MARGIN - (orb.x + orb.width + GAP);
  const toLeft = roomLeft >= roomRight;
  let region = toLeft ? { x: area.x + MARGIN, y: top, width: roomLeft, height } : { x: orb.x + orb.width + GAP, y: top, width: roomRight, height };
  if (region.width < MIN_WIDTH) region = { x: area.x + MARGIN, y: top, width: area.width - 2 * MARGIN, height };

  const byRecent = (a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0);
  const side = panels.filter((p) => SIDE_KINDS.has(p.kind)).sort(byRecent);
  const main = panels.filter((p) => !SIDE_KINDS.has(p.kind)).sort(byRecent);

  // Column width for the work panels; if the big panels then wouldn't fit beside it, everything shares one column.
  const wantColumn = side.length ? Math.max(MIN_WIDTH, ...side.map((p) => Math.min(p.width, 600))) : 0;
  const column = main.length ? Math.min(wantColumn, Math.floor(region.width * 0.45)) : Math.min(wantColumn, region.width);
  const twoColumns = side.length > 0 && main.length > 0 && column >= MIN_WIDTH && region.width - column - GAP >= MIN_WIDTH;

  const overflow = [];
  if (!twoColumns) {
    overflow.push(...stack({ x: region.x, y: region.y, width: region.width, height: region.height }, [...side, ...main], rects, toLeft));
  } else {
    // The work column sits next to the orb; the big panels take the rest.
    const colX = toLeft ? region.x + region.width - column : region.x;
    const mainX = toLeft ? region.x : region.x + column + GAP;
    overflow.push(...stack({ x: colX, y: region.y, width: column, height: region.height }, side, rects, toLeft));
    overflow.push(...tile({ x: mainX, y: region.y, width: region.width - column - GAP, height: region.height }, main, rects, toLeft));
  }

  // No room left: the least recently used cascade down from the region's corner, each kept fully inside the area.
  overflow.sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0)).forEach((p, i) => {
    const width = Math.min(Math.max(p.width, MIN_WIDTH), region.width);
    const h = p.folded ? p.height : Math.min(Math.max(p.height, MIN_HEIGHT), region.height);
    rects[p.kind] = clampInto(area, { x: region.x + i * CASCADE_STEP, y: region.y + i * CASCADE_STEP, width, height: h });
    cascaded.push(p.kind);
  });
  return { rects, cascaded };
}

/** Panels stacked top to bottom in one column, shrunk towards their minimum heights to fit. Returns those that don't. */
function stack(col, items, rects, alignRight) {
  const minOf = (p) => (p.folded ? p.height : Math.min(MIN_HEIGHT, p.height));
  let fitting = [...items];
  // Drop the least recently used until the minimum heights fit.
  while (fitting.length && fitting.reduce((n, p) => n + minOf(p), 0) + GAP * (fitting.length - 1) > col.height) fitting.pop();
  const rest = items.filter((p) => !fitting.includes(p));
  const fixed = fitting.filter((p) => p.folded).reduce((n, p) => n + p.height, 0);
  const heights = fitHeights(
    fitting.filter((p) => !p.folded),
    col.height - fixed - GAP * Math.max(0, fitting.length - 1),
    minOf,
  );
  let y = col.y;
  for (const p of fitting) {
    const width = Math.min(Math.max(p.width, MIN_WIDTH), col.width);
    const h = p.folded ? p.height : heights.get(p);
    rects[p.kind] = { x: alignRight ? col.x + col.width - width : col.x, y, width, height: h };
    y += h + GAP;
  }
  return rest;
}

/**
 * Heights for panels sharing `room`: their own heights if they fit, otherwise shrunk by one shared factor, with any
 * that would go below their minimum held at it and the rest shrunk further to make up for them.
 */
function fitHeights(items, room, minOf) {
  const heights = new Map(items.map((p) => [p, p.height]));
  let atMin = new Set();
  for (let pass = 0; pass <= items.length; pass++) {
    const free = items.filter((p) => !atMin.has(p));
    const held = [...atMin].reduce((n, p) => n + minOf(p), 0);
    const want = free.reduce((n, p) => n + p.height, 0);
    const scale = want > 0 && want > room - held ? Math.max(0, room - held) / want : 1;
    const next = new Set(atMin);
    for (const p of free) {
      const h = Math.floor(p.height * scale);
      if (h < minOf(p)) next.add(p);
      heights.set(p, Math.max(h, minOf(p)));
    }
    for (const p of atMin) heights.set(p, minOf(p));
    if (next.size === atMin.size) break;
    atMin = next;
  }
  return heights;
}

/** The big panels: one fills the area (up to the size it wants), two side by side or stacked, three or more tile. */
function tile(area, items, rects, alignRight) {
  if (!items.length) return [];
  const sized = (p, w, h) => ({ width: Math.min(Math.max(p.width, MIN_WIDTH), w), height: p.folded ? p.height : Math.min(Math.max(p.height, MIN_HEIGHT), h) });
  const place = (p, box) => {
    const s = sized(p, box.width, box.height);
    rects[p.kind] = { x: alignRight ? box.x + box.width - s.width : box.x, y: box.y, ...s };
  };
  if (items.length === 1) {
    place(items[0], area);
    return [];
  }
  const half = Math.floor((area.width - GAP) / 2);
  if (half >= MIN_WIDTH) {
    // Newest beside the work column (nearest the orb), the rest stacked in the other half.
    const nearX = alignRight ? area.x + area.width - half : area.x;
    const farX = alignRight ? area.x : area.x + half + GAP;
    place(items[0], { x: nearX, y: area.y, width: half, height: area.height });
    return stack({ x: farX, y: area.y, width: half, height: area.height }, items.slice(1), rects, alignRight);
  }
  return stack(area, items, rects, alignRight);
}

/** Moves (and if need be shrinks) a rect so it lies wholly inside the area. */
function clampInto(area, r) {
  const width = Math.min(r.width, area.width - 2 * MARGIN);
  const height = Math.min(r.height, area.height - 2 * MARGIN);
  const x = Math.max(area.x + MARGIN, Math.min(r.x, area.x + area.width - MARGIN - width));
  const y = Math.max(area.y + MARGIN, Math.min(r.y, area.y + area.height - MARGIN - height));
  return { x, y, width, height };
}

module.exports = { layoutPanels, MIN_WIDTH, MIN_HEIGHT, GAP };
