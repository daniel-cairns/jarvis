// The terminal panel: every command Astra and her background sessions run, with output, newest at the bottom.
// Text only (textContent): command output is never treated as HTML.
(() => {
  const { onMessage } = window.slab;
  const log = document.getElementById("log");
  const meta = document.getElementById("meta");
  const stamp = document.getElementById("stamp");
  const STATUS = { running: "◌", ok: "✓", error: "✗" };
  const base = (p) => p.split("/").filter(Boolean).at(-1) ?? p;

  onMessage((m) => {
    if (m.type !== "terminal") return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const entries = m.entries ?? [];
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "No commands yet.";
      log.replaceChildren(p);
    } else {
      log.replaceChildren(
        ...entries.map((e) => {
          const item = document.createElement("article");
          item.className = `cmd ${e.status}`;
          const head = document.createElement("div");
          head.className = "cmd-head";
          const status = document.createElement("span");
          status.className = "status";
          status.textContent = STATUS[e.status] ?? "·";
          status.setAttribute("aria-label", e.status);
          const who = document.createElement("span");
          who.className = "who";
          who.textContent = `${e.source} · ${base(e.cwd)}`;
          const time = document.createElement("time");
          time.textContent = new Date(e.at).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          head.append(status, who, time);
          const cmd = document.createElement("pre");
          cmd.className = "line";
          cmd.textContent = `$ ${e.command}`;
          item.append(head, cmd);
          if (e.output) {
            const out = document.createElement("pre");
            out.className = "out";
            out.textContent = e.output;
            item.append(out);
          }
          return item;
        }),
      );
    }
    const running = entries.filter((e) => e.status === "running").length;
    meta.textContent = `ASTRA-01 | CLASS: SHELL | ${entries.length} COMMANDS${running ? ` | ${running} RUNNING` : ""}`;
    stamp.textContent = new Date().toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
    if (nearBottom) log.scrollTop = log.scrollHeight;
  });
})();
