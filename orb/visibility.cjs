// Whether one of Astra's panels can really be seen: read from the on-screen window list (front to back, as the Mac
// control helper lists it), not assumed. Pure maths, shared with the tests.

/** Points sampled across a window (a 5 × 5 grid, inset from the edges) to judge whether it's covered. */
const GRID = 5;

const contains = (r, x, y) => x >= r.X && x <= r.X + r.Width && y >= r.Y && y <= r.Y + r.Height;

/**
 * Where `me` (a window of process `pid` with these bounds) stands among `windows` (front to back): whether it's on
 * screen at all, and whether the windows in front of it cover all of it. A panel that's even partly visible is shown.
 */
function visibilityOf(windows, pid, bounds) {
  const near = (a, b) => Math.abs(a - b) <= 3;
  const index = windows.findIndex(
    (w) =>
      w.pid === pid &&
      w.frame &&
      near(w.frame.X, bounds.x) &&
      near(w.frame.Y, bounds.y) &&
      near(w.frame.Width, bounds.width) &&
      near(w.frame.Height, bounds.height),
  );
  if (index < 0) return { onScreen: false, covered: false, coveredBy: [] };
  const front = windows.slice(0, index).filter((w) => w.frame);
  const coveredBy = new Set();
  let hidden = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = bounds.x + (bounds.width * (i + 0.5)) / GRID;
      const y = bounds.y + (bounds.height * (j + 0.5)) / GRID;
      const over = front.find((w) => contains(w.frame, x, y));
      if (over) {
        hidden++;
        coveredBy.add(over.app ?? "another window");
      }
    }
  }
  return { onScreen: true, covered: hidden === GRID * GRID, coveredBy: [...coveredBy] };
}

module.exports = { visibilityOf };
