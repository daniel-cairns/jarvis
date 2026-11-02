// The open sessions panel: Dan's Claude Code sessions and Astra's background runs, live. Rows come from Astra
// (src/ui/sessionsPanel.ts) with their allowed actions already decided; buttons send requests back, and Astra checks
// them again before acting. Text only (textContent) for anything from a session.
(() => {
  const { bridge, onMessage } = window.slab;
  const { svg, STATUS, MODE } = window.astraGlyphs;
  const list = document.getElementById("list");
  const meta = document.getElementById("meta");
  const stamp = document.getElementById("stamp");
  const announce = document.getElementById("announce");

  const expanded = new Set();
  const drafts = new Map();
  let recentOpen = false;
  let lastStatus = new Map();

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const ago = (at) => {
    const mins = Math.round((Date.now() - at) / 60_000);
    if (!at || mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
  };

  const action = (row, act, extra = {}) => bridge.send({ type: "session-action", action: act, ref: row.ref, ...(row.run ? { run: row.run } : {}), ...extra });

  /** A labelled button; disabled ones keep their reason in the label and title, so it's heard and seen. */
  function button(label, onClick, { disabled = false, why = "" } = {}) {
    const b = el("button", "s-act", label);
    b.type = "button";
    if (disabled) {
      b.disabled = true;
      b.title = why;
      b.setAttribute("aria-label", `${label} (unavailable: ${why})`);
    } else b.addEventListener("click", onClick);
    return b;
  }

  function renderRow(row) {
    const li = el("li", `s-row s-${row.status}`);
    li.dataset.key = row.key;
    const head = el("button", "s-head");
    head.type = "button";
    head.dataset.role = "head";
    head.setAttribute("aria-expanded", String(expanded.has(row.key)));
    // Status glyph: decoration (the status is in the text below). Only working rows move: the sun's rays turn.
    const glyph = el("span", "s-glyph");
    glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = svg(STATUS[row.status] ?? "shen", row.status === "working" ? "is-live" : "");
    const text = el("span", "s-text");
    const titleLine = el("span", "s-title-line");
    titleLine.append(el("span", "s-title", row.title));
    // Astra's own runs carry her eye and say so; Dan's sessions don't.
    if (row.astra) {
      const badge = el("span", "s-astra");
      badge.innerHTML = svg("eye");
      badge.append(el("span", "", "Astra"));
      titleLine.append(badge);
    }
    const sub = el("span", "s-sub", `${row.statusText} · ${row.project} · ${row.where} · ${ago(row.at)}`);
    if (row.mode) {
      const mode = el("span", `s-mode s-mode-${row.mode.key}`);
      if (MODE[row.mode.key]) mode.innerHTML = svg(MODE[row.mode.key]);
      mode.append(el("span", "visually-hidden", "Mode: "), el("span", "", row.mode.label));
      sub.append(" · ", mode);
    }
    text.append(titleLine, sub);
    if (row.now) text.append(el("span", "s-now", row.now));
    head.append(glyph, text);
    head.addEventListener("click", () => {
      if (expanded.has(row.key)) expanded.delete(row.key);
      else expanded.add(row.key);
      render(current);
      focusKey(row.key, "head");
    });
    li.append(head);

    if (expanded.has(row.key)) {
      const more = el("div", "s-more");
      if (row.reply) more.append(el("p", "s-reply", row.reply));
      const acts = el("div", "s-acts");
      acts.setAttribute("role", "group");
      acts.setAttribute("aria-label", `Actions for ${row.title}`);
      if (row.canOpen) acts.append(button("Open in Claude", () => action(row, "open")));
      if (row.run) acts.append(button("Transcript", () => action(row, "transcript")));
      if (row.canStop) acts.append(button("Stop run", () => action(row, "stop")));
      more.append(acts);

      const form = el("form", "s-msg");
      const id = `msg-${row.key.replace(/[^\w-]/g, "_")}`;
      const label = el("label", "visually-hidden", `Message ${row.title}`);
      label.htmlFor = id;
      const box = el("textarea");
      box.id = id;
      box.rows = 2;
      box.dataset.role = "draft";
      box.placeholder = row.canMessage ? "Send a follow-up…" : row.messageWhy;
      box.disabled = !row.canMessage;
      box.value = drafts.get(row.key) ?? "";
      box.addEventListener("input", () => drafts.set(row.key, box.value));
      const send = button("Send", () => {}, { disabled: !row.canMessage, why: row.messageWhy ?? "" });
      send.type = "submit";
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = box.value.trim();
        if (!row.canMessage || !text) return;
        action(row, "message", { text });
        drafts.delete(row.key);
        box.value = "";
      });
      form.append(label, box, send);
      more.append(form);
      li.append(more);
    }
    return li;
  }

  function section(title, rows, empty) {
    const ul = el("ul", "s-list");
    ul.setAttribute("aria-label", title);
    if (!rows.length) ul.append(el("li", "empty", empty));
    for (const r of rows) ul.append(renderRow(r));
    return ul;
  }

  const focusKey = (key, role) => list.querySelector(`[data-key="${CSS.escape(key)}"] [data-role="${role}"]`)?.focus();

  let current = { open: [], recent: [] };
  function render(view) {
    current = view;
    // Keep whatever had focus (a row, or the message being typed) where it was.
    const active = document.activeElement;
    const keep = active && list.contains(active) ? { key: active.closest("[data-key]")?.dataset.key, role: active.dataset.role } : null;
    const recent = el("details", "s-recent");
    recent.open = recentOpen;
    recent.addEventListener("toggle", () => (recentOpen = recent.open));
    recent.append(el("summary", "", `Recent (${view.recent.length})`), section("Recent sessions", view.recent, "Nothing else in the last day."));
    list.replaceChildren(el("h2", "s-h", "Open"), section("Open sessions", view.open, "No sessions open right now."), recent);
    if (keep?.key && keep.role) focusKey(keep.key, keep.role);
  }

  /** Says what changed, politely and only on a change (not every refresh). */
  function announceChanges(view, note) {
    const said = [];
    const next = new Map();
    for (const r of [...view.open, ...view.recent]) {
      next.set(r.key, r.status);
      const before = lastStatus.get(r.key);
      if (lastStatus.size && before && before !== r.status) said.push(`${r.title}: ${r.statusText.toLowerCase()}`);
    }
    lastStatus = next;
    if (note) said.unshift(note);
    if (said.length) announce.textContent = said.join(". ");
  }

  onMessage((m) => {
    if (m.type !== "sessions") return;
    const waiting = m.open.filter((r) => r.status === "waiting").length;
    meta.textContent = `${m.open.length} OPEN${waiting ? ` | ${waiting} WAITING` : ""}`;
    render(m);
    announceChanges(m, m.note);
    stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  });
})();
