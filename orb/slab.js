// Shared chrome for the work panels (terminal, git): drag by the faceplate, close, and collapse to the header.
// Each page's own script reads window.slab.bridge and window.slab.onMessage.
(() => {
  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const bar = document.getElementById("bar");
  const collapse = document.getElementById("collapse");
  const slab = document.querySelector(".slab");

  const close = () => bridge.send({ type: "panel-close" });
  document.getElementById("close").addEventListener("click", close);

  function setCollapsed(collapsed) {
    slab.classList.toggle("collapsed", collapsed);
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.textContent = collapsed ? "▸" : "▾";
    collapse.title = collapsed ? "Expand" : "Collapse";
    const header = document.querySelector(".shelf").getBoundingClientRect().bottom;
    bridge.send({ type: "slab-collapse", collapsed, height: Math.ceil(header + 10) });
  }
  collapse.addEventListener("click", () => setCollapsed(!slab.classList.contains("collapsed")));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    bar.setPointerCapture(e.pointerId);
    bridge.send({ type: "drag-start" });
  });
  const endDrag = () => bridge.send({ type: "drag-end" });
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("lostpointercapture", endDrag);

  window.slab = { bridge, onMessage: (fn) => bridge.onMessage(fn) };
})();
