// The transcript panel: a background session's run, live and compact: what it says, and each step it takes.
// Text only (textContent): nothing from a run is treated as HTML.
(() => {
  const { onMessage } = window.slab;
  const log = document.getElementById("log");
  const title = document.getElementById("title");
  const meta = document.getElementById("meta");
  const stamp = document.getElementById("stamp");
  const STATUS = { running: "WORKING", done: "DONE", failed: "FAILED", stopped: "STOPPED" };

  onMessage((m) => {
    if (m.type !== "transcript") return;
    // Follow the newest line, unless you've scrolled up to read something.
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    title.textContent = `${m.job.label} · ${m.job.id}`;
    document.title = `Astra · Transcript · ${m.job.label}`;
    // Short enough to fit the narrow header, so the status always shows.
    meta.textContent = `RUN | ${STATUS[m.job.status] ?? "IDLE"}`;
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
