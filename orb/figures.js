// Which god stands behind the orb: Anubis guarding (a page being checked or blocked, a voice refused) or Thoth
// researching. Anubis wins: while he's up, Thoth steps back until it's over. Shared with the tests, so no DOM.
(function (root) {
  /** Where each figure is heading (0 hidden, 1 risen), from the guard and scribe states and whether the orb is open. */
  function figureTargets({ guard = null, scribe = null, open = true } = {}) {
    if (!open) return { anubis: 0, thoth: 0 };
    const anubis = guard ? 1 : 0;
    return { anubis, thoth: scribe && !anubis ? 1 : 0 };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { figureTargets };
  else root.astraFigures = { figureTargets };
})(globalThis);
