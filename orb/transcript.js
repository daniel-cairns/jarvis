// The transcript panel: a background session's run, live and compact: what it says, and each step it takes.
// Text only (textContent): nothing from a run is treated as HTML.
(() => {
  const { onMessage } = window.slab;
  const log = document.getElementById("log");
  const title = document.getElementById("title");
  const meta = document.getElementById("meta");
  const stamp = document.getElementById("stamp");
  const STATUS = { running: "WORKING", done: "DONE", failed: "FAILED", stopped: "STOPPED" };
  const runes = document.getElementById("runes");
  const stateText = document.getElementById("state-text");
  const { svg } = window.astraGlyphs;
  const { frame, TICK, LABEL } = window.astraRunes;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  // The glyph row: rolls in the state's own rhythm, settles when the run ends. Fixed width, so nothing shifts.
  let state = { phase: "thinking" };
  let tick = 0;
  let timer = null;
  const draw = () => (runes.innerHTML = frame(state, tick).map((g) => svg(g.name, g.dim ? "dim" : "")).join(""));
  const animate = () => {
    clearInterval(timer);
    timer = null;
    draw();
    const every = TICK[state.phase] ?? 0;
    // Reduced motion: one still frame per state, no flicker.
    if (!every || reduced.matches) return;
    timer = setInterval(() => {
      tick++;
      draw();
    }, every);
  };
  const setState = (next) => {
    const changed = next.phase !== state.phase || next.glyph !== state.glyph;
    if (next.phase !== state.phase) tick = 0;
    state = next;
    if (!changed && timer) return;
    // Spoken once per change, not every frame.
    const label = LABEL[next.phase] ?? "";
    if (stateText.textContent !== label) stateText.textContent = label;
    animate();
  };
  reduced.addEventListener("change", animate);

  onMessage((m) => {
    if (m.type !== "transcript") return;
    // Follow the newest line, unless you've scrolled up to read something.
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    title.textContent = `${m.job.label} · ${m.job.id}`;
    document.title = `Astra · Transcript · ${m.job.label}`;
    // Short enough to fit the narrow header, so the status always shows.
    meta.textContent = `RUN | ${STATUS[m.job.status] ?? "IDLE"}`;
    setState(m.state ?? (m.job.status === "running" ? { phase: "thinking" } : { phase: m.job.status }));
    if (!m.lines.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Starting…";
      log.replaceChildren(p);
    } else {
      log.replaceChildren(
        ...m.lines.map((l) => {
          const p = document.createElement("p");
          p.className = `t-${l.kind}`;
          p.textContent = l.text;
          return p;
        }),
      );
    }
    stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
    if (nearBottom) log.scrollTop = log.scrollHeight;
  });
})();
