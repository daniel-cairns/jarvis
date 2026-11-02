// Which stargate chevrons are lit during a dial. Chevron 0 is the master at the top; the other eight light in mirror
// pairs from the top down, one pair per lock (1 and 8, then 2 and 7, 3 and 6, 4 and 5), so both sides light evenly,
// and when every pair is in the whole ring glows. Shared with the tests, so it has no DOM in it.
(function (root) {
  /** How many locks a full dial takes: one per mirror pair. */
  const locksFor = (chevrons) => Math.floor(chevrons / 2);

  /** Whether chevron c is lit once `locked` locks have engaged (the master at the top only once all are in). */
  function chevronLit(c, locked, chevrons) {
    if (c === 0) return locked >= locksFor(chevrons);
    return Math.min(c, chevrons - c) <= locked;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { chevronLit, locksFor };
  else root.astraDial = { chevronLit, locksFor };
})(globalThis);
