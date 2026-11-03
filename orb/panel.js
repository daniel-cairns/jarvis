// The detail panel: shows HTML Astra rendered (already sanitised in Node; this page's CSP blocks any script in it).
(() => {
  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const title = document.getElementById("title");
  const content = document.getElementById("content");
  const stamp = document.getElementById("stamp");

  bridge.onMessage((m) => {
    if (m.type !== "detail") return;
    title.textContent = m.title;
    document.title = `Astra · ${m.title}`;
    content.innerHTML = m.html;
    addCopyButtons();
    // A live transcript keeps its newest line in view; anything else opens at the top.
    content.scrollTop = m.follow ? content.scrollHeight : 0;
    stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  });

  const status = document.getElementById("copy-status");

  /** Gives every code block a Copy button that puts its exact text on the clipboard. */
  function addCopyButtons() {
    for (const pre of content.querySelectorAll("pre")) {
      // Read before the button joins the block, so its label never lands in the copied text.
      const text = (pre.querySelector("code") ?? pre).textContent ?? "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-btn";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy this block to the clipboard");
      button.addEventListener("click", () => {
        bridge.send({ type: "copy-text", text });
        button.textContent = "Copied";
        button.classList.add("copied");
        status.textContent = "Copied to the clipboard";
        clearTimeout(button.resetTimer);
        button.resetTimer = setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("copied");
          status.textContent = "";
        }, 1600);
      });
      pre.prepend(button);
    }
  }

  const close = () => bridge.send({ type: "panel-close" });
  document.getElementById("close").addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

})();
