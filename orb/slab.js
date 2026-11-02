// Shared chrome for the work panels (terminal, git, transcript): drag by the faceplate, close, and fold to the header.
// Each page's own script reads window.slab.bridge and window.slab.onMessage.
(() => {
  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const collapse = document.getElementById("collapse");
  const slab = document.querySelector(".slab");

  const close = () => bridge.send({ type: "panel-close" });
  document.getElementById("close").addEventListener("click", close);

  function setCollapsed(collapsed) {
    slab.classList.toggle("collapsed", collapsed);
    collapse.setAttribute("aria-expanded", String(!collapsed));
    // A status line that doubles as the toggle (transcript) keeps its text; the round fold button shows an arrow.
    if (!collapse.classList.contains("fold-line")) collapse.textContent = collapsed ? "▸" : "▾";
    collapse.title = collapsed ? "Expand" : "Collapse";
    const header = document.querySelector(".shelf").getBoundingClientRect().bottom;
    bridge.send({ type: "slab-collapse", collapsed, height: Math.ceil(header + 10) });
  }
  collapse.addEventListener("click", () => setCollapsed(!slab.classList.contains("collapsed")));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Unfolded from the orb's dropdown.
  bridge.onMessage((m) => {
    if (m.type === "slab-expand" && slab.classList.contains("collapsed")) setCollapsed(false);
  });

  window.slab = { bridge, onMessage: (fn) => bridge.onMessage(fn) };
})();
