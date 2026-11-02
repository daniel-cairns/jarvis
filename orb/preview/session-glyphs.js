// The sessions-panel glyph preview: a legend, and a stand-in for the panel's bridge that feeds sessions.js sample rows.
(() => {
  const { svg, STATUS, MODE } = window.astraGlyphs;
  const legend = [
    ["Working (rays turn)", STATUS.working, "is-live"],
    ["Waiting on you", STATUS.waiting],
    ["Idle or done", STATUS.idle],
    ["Failed or stopped", STATUS.failed],
    ["Astra's background run", "eye"],
    ["Mode: Auto", MODE.auto],
    ["Mode: Plan", MODE.plan],
    ["Mode: Accept edits", MODE.acceptEdits],
  ];
  document.getElementById("legend").innerHTML = legend
    .map(([label, name, cls = ""]) => `<li><span class="tile small">${svg(name, cls)}</span><span class="tile big">${svg(name, cls)}</span><span>${label}</span></li>`)
    .join("");

  const now = Date.now();
  const row = (key, status, statusText, title, where, extra = {}) => ({
    key,
    ref: key,
    title,
    project: "jarvis",
    where,
    astra: false,
    status,
    statusText,
    state: { phase: "thinking" },
    at: now - 4 * 60_000,
    now: "Latest: ran the test suite, 259 passing.",
    reply: "All green.",
    canOpen: true,
    canMessage: status !== "working",
    messageWhy: status === "working" ? "It's working; you can message it once it's idle." : undefined,
    canStop: false,
    ...extra,
  });
  const sample = {
    type: "sessions",
    open: [
      row("s3", "working", "Working", "Sessions panel glyphs", "Background run s3", { astra: true, run: "s3", canStop: true, mode: { key: "auto", label: "Auto" } }),
      row("a", "working", "Working", "Character movement", "Claude app", { mode: { key: "acceptEdits", label: "Accept edits" } }),
      row("b", "waiting", "Waiting on you", "Hierogitics logo", "Claude app", { mode: { key: "plan", label: "Plan" } }),
      row("c", "idle", "Idle", "Menu creation", "Terminal", { mode: { key: "default", label: "Ask" } }),
    ],
    recent: [
      row("s1", "done", "Done", "Coffee mode", "Background run s1", { astra: true, run: "s1", mode: { key: "auto", label: "Auto" } }),
      row("s2", "failed", "Failed", "Port fix", "Background run s2", { astra: true, run: "s2" }),
    ],
  };
  window.slab = {
    bridge: { send: () => {} },
    onMessage: (fn) => setTimeout(() => fn(sample)),
  };
})();
