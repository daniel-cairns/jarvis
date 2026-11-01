// The detail panel: shows HTML Astra rendered (already sanitised in Node; this page's CSP blocks any script in it).
(() => {
  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const title = document.getElementById("title");
  const content = document.getElementById("content");
  const stamp = document.getElementById("stamp");
  const bar = document.getElementById("bar");

  bridge.onMessage((m) => {
    if (m.type !== "detail") return;
    title.textContent = m.title;
    document.title = `Astra · ${m.title}`;
    content.innerHTML = m.html;
    content.scrollTop = 0;
    stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  });

  const close = () => bridge.send({ type: "panel-close" });
  document.getElementById("close").addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Drag by the top bar (the main process moves the window with the cursor).
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    bar.setPointerCapture(e.pointerId);
    bridge.send({ type: "drag-start" });
  });
  const end = () => bridge.send({ type: "drag-end" });
  bar.addEventListener("pointerup", end);
  bar.addEventListener("lostpointercapture", end);
})();
