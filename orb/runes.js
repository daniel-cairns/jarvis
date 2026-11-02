// The flickering row of ring glyphs in front of a run's transcript: Astra's spinner. Each state has its own rhythm,
// and the row settles and stops when the run ends. Pure frame maths here; transcript.js draws and times it.
(() => {
  const RING = ["ankh", "eye", "water", "djed", "sun", "reed"];
  const SLOTS = 5;

  /** What each state is called (for the screen-reader text; the glyphs themselves are decoration). */
  const LABEL = {
    thinking: "Thinking",
    tool: "Working",
    waiting: "Waiting on you",
    done: "Done",
    failed: "Failed",
    stopped: "Stopped",
  };

  /** Milliseconds between frames; 0 means it has settled and doesn't move. */
  const TICK = { thinking: 420, tool: 160, waiting: 1100, done: 0, failed: 0, stopped: 0 };

  const fixed = (names, dimmed = []) => names.map((name, i) => ({ name, dim: dimmed.includes(i) }));

  /**
   * The row at a given tick: five glyphs, each bright or dim.
   * - thinking: every glyph rolls slowly through the ring, out of step with its neighbours.
   * - tool: the tool's own glyph holds the centre while the others flip fast around it.
   * - waiting: reeds (asking) that breathe, nothing rolling.
   * - done / failed / stopped: a still row.
   */
  function frame(state, tick) {
    const phase = state?.phase ?? "thinking";
    if (phase === "done") return fixed(["sun", "eye", "ankh", "eye", "sun"]);
    if (phase === "failed") return fixed(["djed", "water", "eye", "water", "djed"], [0, 1, 3, 4]);
    if (phase === "stopped") return fixed(["reed", "reed", "djed", "reed", "reed"], [0, 1, 2, 3, 4]);
    if (phase === "waiting") return fixed(Array(SLOTS).fill("reed"), tick % 2 ? [0, 1, 3, 4] : []);
    if (phase === "tool") {
      const centre = RING.includes(state.glyph) ? state.glyph : "djed";
      return Array.from({ length: SLOTS }, (_, i) =>
        i === 2 ? { name: centre, dim: false } : { name: RING[(tick * 5 + i * 7 + ((tick >> 1) % 3) * i) % RING.length], dim: (tick + i) % 3 === 0 },
      );
    }
    return Array.from({ length: SLOTS }, (_, i) => ({ name: RING[(tick + i * 2) % RING.length], dim: (tick + i) % 3 === 0 }));
  }

  const api = { RING, SLOTS, LABEL, TICK, frame };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.astraRunes = api;
})();
