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
    // A live transcript keeps its newest line in view; anything else opens at the top.
    content.scrollTop = m.follow ? content.scrollHeight : 0;
    stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  });

  const close = () => bridge.send({ type: "panel-close" });
  document.getElementById("close").addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

})();
