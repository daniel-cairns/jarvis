// Drag a panel by its whole top strip: the drawer tab, the rail under it, the faceplate, and the empty space beside
// the tab. Shared by every panel (the main process moves the window with the cursor).
(() => {
  const bridge = window.jarvis ?? { send() {} };
  const slab = document.querySelector(".slab");
  const bar = document.getElementById("bar");
  if (!slab || !bar) return;

  /** Whether a press here should drag: anywhere from the top edge down to the bottom of the faceplate, except controls. */
  const isHandle = (e) => {
    if (e.button !== 0 || e.target.closest("button, a, input, select, textarea")) return false;
    return e.clientY <= bar.getBoundingClientRect().bottom;
  };

  slab.addEventListener("pointerdown", (e) => {
    if (!isHandle(e)) return;
    bridge.send({ type: "drag-start" });
    // Keeps the drag going when the cursor outruns the window.
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {
      // Not a live pointer (a synthetic event): nothing to capture.
    }
  });
  const end = () => bridge.send({ type: "drag-end" });
  slab.addEventListener("pointerup", end);
  slab.addEventListener("lostpointercapture", end);
})();
