// The brain browser: every note and teardown by folder, searchable, read in place, with "Show map" for saved maps.
// Note HTML is rendered and sanitised in Node (src/ui/detail.ts); this page's CSP blocks any script in it.
(() => {
  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const groups = document.getElementById("groups");
  const search = document.getElementById("search");
  const note = document.getElementById("note");
  const meta = document.getElementById("meta");
  const stamp = document.getElementById("stamp");

  const FOLDER_NAMES = { teardowns: "Teardowns", projects: "Projects", notes: "Notes" };
  const ORDER = ["teardowns", "projects", "notes"];
  let notes = [];
  let openPath = null;

  const day = (iso) => new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = notes.filter((n) => !q || `${n.title} ${n.folder} ${n.snippet}`.toLowerCase().includes(q));
    const folders = [...new Set(shown.map((n) => n.folder))].sort(
      (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
    );
    groups.replaceChildren(
      ...folders.map((folder) => {
        const section = document.createElement("section");
        const h = document.createElement("h2");
        h.textContent = `${FOLDER_NAMES[folder] ?? folder} · ${shown.filter((n) => n.folder === folder).length}`;
        const list = document.createElement("ul");
        list.append(
          ...shown
            .filter((n) => n.folder === folder)
            .map((n) => {
              const li = document.createElement("li");
              const b = document.createElement("button");
              b.type = "button";
              b.dataset.path = n.path;
              if (n.path === openPath) b.setAttribute("aria-current", "true");
              const t = document.createElement("span");
              t.className = "t";
              t.textContent = n.title;
              const d = document.createElement("span");
              d.className = "d";
              d.textContent = `${day(n.modified)}${n.hasMap ? " · ◈ map" : ""}`;
              b.append(t, d);
              li.append(b);
              return li;
            }),
        );
        section.append(h, list);
        return section;
      }),
    );
    if (!shown.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = q ? "Nothing matches that search." : "No notes yet.";
      groups.append(p);
    }
  }

  function showNote(m) {
    openPath = m.path;
    const head = document.createElement("div");
    head.className = "note-head";
    const h = document.createElement("h2");
    h.textContent = m.title;
    head.append(h);
    if (m.hasMap) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "map";
      b.textContent = "◈ Show map";
      b.addEventListener("click", () => bridge.send({ type: "brain-map", path: m.path }));
      head.append(b);
    }
    const body = document.createElement("div");
    body.className = "note-body";
    body.innerHTML = m.html;
    note.replaceChildren(head, body);
    note.scrollTop = 0;
    render();
  }

  bridge.onMessage((m) => {
    if (m.type === "brain") {
      notes = m.notes || [];
      meta.textContent = `ASTRA-01 | CLASS: ARCHIVE | ${notes.length} NOTES`;
      stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
      render();
      search.focus();
    } else if (m.type === "brain-note") showNote(m);
  });

  groups.addEventListener("click", (e) => {
    const path = e.target.closest("[data-path]")?.dataset.path;
    if (path) bridge.send({ type: "brain-open", path });
  });
  search.addEventListener("input", render);

  const close = () => bridge.send({ type: "panel-close" });
  document.getElementById("close").addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
})();
