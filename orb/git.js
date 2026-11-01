// The git changes panel: repos Astra (or her background sessions) touched, branch, changed files with +/− counts,
// and a file's diff on click. All text via textContent.
(() => {
  const { bridge, onMessage } = window.slab;
  const box = document.getElementById("repos");
  const meta = document.getElementById("meta");
  const stamp = document.getElementById("stamp");
  const open = new Set(); // "root\0path" of files whose diff is showing
  const STATUS = { "??": ["U", "untracked"], "A ": ["A", "added"], " M": ["M", "modified"], "M ": ["M", "modified"], MM: ["M", "modified"], " D": ["D", "deleted"], "D ": ["D", "deleted"], "R ": ["R", "renamed"] };
  const diffs = new Map();

  function renderDiff(pre, text) {
    pre.replaceChildren(
      ...text.split("\n").map((line) => {
        const span = document.createElement("span");
        span.className = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : "";
        span.textContent = `${line}\n`;
        return span;
      }),
    );
  }

  function render(repos) {
    if (!repos.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "No repos touched yet.";
      box.replaceChildren(p);
      return;
    }
    box.replaceChildren(
      ...repos.map((r) => {
        const section = document.createElement("section");
        const h = document.createElement("h2");
        h.textContent = `${r.name} · ${r.branch} · ${r.files.length ? `${r.files.length} changed` : "clean"}`;
        const list = document.createElement("ul");
        list.append(
          ...r.files.map((f) => {
            const li = document.createElement("li");
            const b = document.createElement("button");
            b.type = "button";
            const key = `${r.root}\0${f.path}`;
            b.setAttribute("aria-expanded", String(open.has(key)));
            const [letter, word] = STATUS[f.status] ?? [f.status.trim() || "?", "changed"];
            const badge = document.createElement("span");
            badge.className = `badge ${word}`;
            badge.textContent = letter;
            badge.title = word;
            const name = document.createElement("span");
            name.className = "path";
            name.textContent = f.path;
            const counts = document.createElement("span");
            counts.className = "counts";
            const add = document.createElement("span");
            add.className = "add";
            add.textContent = f.added ? `+${f.added}` : "";
            const del = document.createElement("span");
            del.className = "del";
            del.textContent = f.removed ? `−${f.removed}` : "";
            counts.append(add, " ", del);
            b.append(badge, name, counts);
            b.addEventListener("click", () => {
              if (open.has(key)) open.delete(key);
              else {
                open.add(key);
                bridge.send({ type: "git-diff", root: r.root, path: f.path });
              }
              render(lastRepos);
            });
            li.append(b);
            if (open.has(key)) {
              const pre = document.createElement("pre");
              pre.className = "diff";
              renderDiff(pre, diffs.get(key) ?? "Loading…");
              li.append(pre);
            }
            return li;
          }),
        );
        section.append(h, list);
        return section;
      }),
    );
  }

  let lastRepos = [];
  onMessage((m) => {
    if (m.type === "git") {
      lastRepos = m.repos ?? [];
      const files = lastRepos.reduce((n, r) => n + r.files.length, 0);
      meta.textContent = `ASTRA-01 | CLASS: CHANGES | ${lastRepos.length} REPOS | ${files} FILES`;
      stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
      // Refresh any open diffs, since the files may have changed.
      for (const key of open) {
        const [root, path] = key.split("\0");
        bridge.send({ type: "git-diff", root, path });
      }
      render(lastRepos);
    } else if (m.type === "git-diff-result") {
      diffs.set(`${m.root}\0${m.path}`, m.diff);
      render(lastRepos);
    }
  });
})();
