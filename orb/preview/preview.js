// Fills the preview page: both coffee-mode candidates, still and animated, plus the transcript state rows.
(() => {
  const { svg, RING_NAMES } = window.astraGlyphs;
  const { frame, TICK, LABEL } = window.astraRunes;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const tile of document.querySelectorAll("[data-glyph]")) {
    tile.innerHTML = svg(tile.dataset.glyph, tile.dataset.live ? "is-live" : "");
  }
  document.getElementById("ring").innerHTML =
    RING_NAMES.map((n) => svg(n)).join("") + `<span class="new">${svg("clepsydra", "is-live")} ${svg("aten", "is-live")}</span>`;

  const demos = [
    { phase: "thinking" },
    { phase: "tool", glyph: "djed" },
    { phase: "tool", glyph: "eye" },
    { phase: "waiting" },
    { phase: "done" },
    { phase: "failed" },
  ];
  const list = document.getElementById("runes");
  const rows = demos.map((state) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="runes" aria-hidden="true"></span><span>${LABEL[state.phase]}${state.glyph ? ` (${state.glyph} tool)` : ""}</span>`;
    list.append(li);
    return { state, el: li.firstChild, tick: 0, last: 0 };
  });
  const draw = (r) => (r.el.innerHTML = frame(r.state, r.tick).map((g) => svg(g.name, g.dim ? "dim" : "")).join(""));
  rows.forEach(draw);
  if (still) return;
  const loop = (now) => {
    for (const r of rows) {
      const every = TICK[r.state.phase];
      if (every && now - r.last >= every) {
        r.last = now;
        r.tick++;
        draw(r);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
