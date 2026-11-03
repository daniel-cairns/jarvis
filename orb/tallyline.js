// The compact Tallyline panel: the active sprint, today's filed time and the latest issues, refreshed by Astra while
// it's open. Issue links and the expand control open the full app in a larger panel. Text only (textContent).
(() => {
  const { bridge, onMessage } = window.slab;
  const { view } = window.tallylineView;
  const body = document.getElementById("body");
  const meta = document.getElementById("meta");
  const stamp = document.getElementById("stamp");
  const announce = document.getElementById("announce");
  let lastState = "";

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const open = (path) => bridge.send({ type: "tallyline-open", path });
  document.getElementById("expand").addEventListener("click", () => open("/"));

  function render(v) {
    meta.textContent = v.meta;
    if (v.state === "error") {
      const p = el("p", "t-error", v.error);
      p.setAttribute("role", "alert");
      body.replaceChildren(p, el("p", "empty", 'Say "show Tallyline" to try again.'));
      return;
    }
    if (v.state !== "ready") return void body.replaceChildren(el("p", "empty", v.state === "starting" ? "Starting Tallyline…" : "Checking Tallyline…"));

    const parts = [];
    const sprint = el("section", "t-sprint");
    sprint.setAttribute("aria-labelledby", "t-sprint-h");
    const h = el("h2", "s-h", v.sprint ? v.sprint.name : "No active sprint");
    h.id = "t-sprint-h";
    sprint.append(h);
    if (v.sprint) {
      sprint.append(el("p", "t-counts", v.sprint.text));
      // A stacked bar of the same counts: decoration, since the sentence above says it all.
      const bar = el("div", "t-bar");
      bar.setAttribute("aria-hidden", "true");
      for (const c of v.sprint.counts) {
        const seg = el("span", `t-seg t-${c.label.toLowerCase().replace(/ /g, "-")}`);
        seg.style.flexGrow = String(c.n);
        bar.append(seg);
      }
      if (v.sprint.total) sprint.append(bar);
      const board = el("button", "s-act", "Open the board");
      board.type = "button";
      board.addEventListener("click", () => open(v.sprint.board));
      sprint.append(board);
    }
    parts.push(sprint);
    parts.push(el("p", "t-today", `Filed today: ${v.today}`));

    const recentH = el("h2", "s-h", "Recently updated");
    recentH.id = "t-recent-h";
    const list = el("ul", "s-list");
    list.setAttribute("aria-labelledby", "t-recent-h");
    if (!v.recent.length) list.append(el("li", "empty", "No issues yet."));
    for (const r of v.recent) {
      const li = el("li", "t-issue");
      const b = el("button", "t-issue-link");
      b.type = "button";
      b.append(el("span", "t-key", r.key), el("span", "t-summary", r.summary), el("span", "t-status", r.status));
      b.setAttribute("aria-label", `${r.key}: ${r.summary}. ${r.status}. Opens in the full app.`);
      b.addEventListener("click", () => open(r.path));
      li.append(b);
      list.append(li);
    }
    parts.push(recentH, list);
    // Keep focus on the same control across refreshes.
    const active = document.activeElement;
    const keep = active && body.contains(active) ? active.getAttribute("aria-label") || active.textContent : null;
    body.replaceChildren(...parts);
    if (keep) [...body.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent) === keep)?.focus();
  }

  onMessage((m) => {
    if (m.type !== "tallyline") return;
    const v = view(m);
    render(v);
    // Announce only changes of state (starting, ready, failed), not every refresh.
    if (v.state !== lastState) announce.textContent = v.state === "error" ? `Tallyline: ${v.error}` : v.state === "ready" ? "Tallyline is up to date." : "";
    lastState = v.state;
    stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  });
})();
