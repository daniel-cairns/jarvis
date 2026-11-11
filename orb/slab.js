// Shared chrome for the work panels (terminal, git, transcript, sessions, Tallyline): close, and the message bridge.
// Folding is fold.js (every panel); dragging is drag.js.
// Each page's own script reads window.slab.bridge and window.slab.onMessage.
(() => {
  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const close = () => bridge.send({ type: "panel-close" });
  document.getElementById("close").addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  window.slab = { bridge, onMessage: (fn) => bridge.onMessage(fn) };
})();
