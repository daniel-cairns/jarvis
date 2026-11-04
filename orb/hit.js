// Which parts of the orb window catch the pointer. The window is a big transparent rectangle floating over every app;
// only what's drawn should take clicks, so her click area is the shape of her body, not a box round it. Clicks on the
// empty space pass through to the app underneath. Shared with the tests, so no DOM.
(function (root) {
  /** Below this canvas alpha (0–255) a pixel counts as empty: her faint outer glow doesn't catch clicks. */
  const SOLID_ALPHA = 40;

  /**
   * Whether the point under the pointer is part of Astra: any control or card, or a drawn pixel of the orb itself.
   * `target` is "canvas" for the orb drawing, "control" for anything else drawn in HTML, "empty" for the bare window.
   */
  function isSolid({ target, alpha = 0 }) {
    if (target === "control") return true;
    if (target === "canvas") return alpha >= SOLID_ALPHA;
    return false;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { isSolid, SOLID_ALPHA };
  else root.astraHit = { isSolid };
})(globalThis);
