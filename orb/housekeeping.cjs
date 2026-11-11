// Keeping Astra's panels tidy without Dan: pure rules (no Electron), applied by main.cjs.
//
// - A panel nobody has used for a while closes, even one Dan clicked into. "Used" means opened or shown on purpose,
//   or clicked into; a live refresh (the sessions list ticking over) doesn't count.
// - No more than a few panels are open at once: opening another closes the one used longest ago.
// - A panel dragged or resized by hand keeps its spot for a while, then rejoins the layout.
// The panel Dan is in (focused) is never touched, nor the full Tallyline app, which is a real app window.

/** A panel unused this long closes. */
const IDLE_MS = 5 * 60_000;
/** A panel placed by hand rejoins the layout after this long unused (well before it would close). */
const REJOIN_MS = 2 * 60_000;
/** At most this many panels open at once. */
const MAX_OPEN = 4;
/** Never closed or moved by housekeeping. */
const KEEP = new Set(["tallyline-app"]);

/**
 * What to do with the open panels now: which to close (unused too long) and which to bring back into the layout.
 * Each panel is { kind, lastUsed, focused, pinned }.
 */
function housekeep(panels, now, idleMs = IDLE_MS, rejoinMs = REJOIN_MS) {
  const free = panels.filter((p) => !p.focused && !KEEP.has(p.kind));
  const close = free.filter((p) => now - (p.lastUsed ?? 0) >= idleMs).map((p) => p.kind);
  const rejoin = free.filter((p) => p.pinned && !close.includes(p.kind) && now - (p.lastUsed ?? 0) >= rejoinMs).map((p) => p.kind);
  return { close, rejoin };
}

/** The panels to close so no more than `max` stay open: the ones used longest ago, never `keep` (the new one). */
function overCap(panels, keep, max = MAX_OPEN) {
  const extra = panels.length - max;
  if (extra <= 0) return [];
  return panels
    .filter((p) => p.kind !== keep && !p.focused && !KEEP.has(p.kind))
    .sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0))
    .slice(0, extra)
    .map((p) => p.kind);
}

module.exports = { housekeep, overCap, IDLE_MS, REJOIN_MS, MAX_OPEN };
