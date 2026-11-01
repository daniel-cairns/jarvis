// "Stack windows": lays Astra's open panels out tidily beside the orb, in columns working outwards from it.
// Pure layout (no Electron) so it can be tested; main.cjs applies the result.

const GAP = 10;
const MARGIN = 12;
const MIN_WIDTH = 340;
const MIN_HEIGHT = 60;

/**
 * @param {{ x: number, y: number, width: number, height: number }} area  the screen's work area
 * @param {{ x: number, y: number, width: number, height: number }} orb   the orb window
 * @param {{ kind: string, width: number, height: number }[]} panels     open panels, in stacking order
 * @returns {Record<string, { x: number, y: number, width: number, height: number }>}
 */
function stackLayout(area, orb, panels) {
  if (!panels.length) return {};
  // Stack on whichever side of the orb has more room.
  const roomLeft = orb.x - area.x - MARGIN - GAP;
  const roomRight = area.x + area.width - (orb.x + orb.width) - MARGIN - GAP;
  const toLeft = roomLeft >= roomRight;
  const room = Math.max(MIN_WIDTH, toLeft ? roomLeft : roomRight);
  const tall = area.height - 2 * MARGIN;

  // Fill columns top to bottom; a panel that doesn't fit under the last one starts a new column.
  const columns = [];
  for (const p of panels) {
    const height = Math.max(MIN_HEIGHT, Math.min(p.height, tall));
    const col = columns.at(-1);
    if (col && col.used + GAP + height <= tall) {
      col.items.push({ ...p, height });
      col.used += GAP + height;
      col.width = Math.max(col.width, p.width);
    } else columns.push({ items: [{ ...p, height }], used: height, width: p.width });
  }

  // Too wide for the room: narrow every column by the same factor (not below MIN_WIDTH).
  const total = columns.reduce((n, c) => n + c.width, 0) + GAP * (columns.length - 1);
  const scale = total > room ? Math.max(0, room - GAP * (columns.length - 1)) / (total - GAP * (columns.length - 1)) : 1;
  for (const c of columns) c.width = Math.max(MIN_WIDTH, Math.floor(c.width * scale));

  const out = {};
  let edge = toLeft ? orb.x - GAP : orb.x + orb.width + GAP;
  for (const c of columns) {
    const x = toLeft ? edge - c.width : edge;
    // Keep each column on screen even when narrowing couldn't make everything fit (later columns then overlap).
    const left = Math.max(area.x + MARGIN, Math.min(x, area.x + area.width - MARGIN - c.width));
    let y = area.y + MARGIN;
    for (const item of c.items) {
      out[item.kind] = { x: left, y, width: c.width, height: item.height };
      y += item.height + GAP;
    }
    edge = toLeft ? x - GAP : x + c.width + GAP;
  }
  return out;
}

module.exports = { stackLayout };
