// Her beam on the control overlay: a blue ray from the orb's core to the window she's working in (see sendBeam in
// main.cjs). Coordinates arrive in this window's own points. The ray ends on the window's edge, nearest the orb.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("beam");
  const bridge = window.jarvis ?? { onMessage() {} };
  const el = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  /** Where a ray from `p` first meets the rectangle: the nearest point on its edge (its centre if `p` is inside). */
  const landing = (p, r) => {
    const inside = p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
    if (inside) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    return { x: Math.min(Math.max(p.x, r.x), r.x + r.width), y: Math.min(Math.max(p.y, r.y), r.y + r.height) };
  };
  bridge.onMessage((m) => {
    if (m.type !== "beam") return;
    if (!m.from || !m.to) return svg.replaceChildren();
    const end = landing(m.from, m.to);
    const line = (cls) => el("line", { class: cls, x1: m.from.x, y1: m.from.y, x2: end.x, y2: end.y });
    svg.replaceChildren(
      el("rect", { class: "frame", x: m.to.x + 1, y: m.to.y + 1, width: Math.max(0, m.to.width - 2), height: Math.max(0, m.to.height - 2), rx: 10 }),
      line("glow"),
      line("ray"),
      line("pulse"),
      el("circle", { class: "hit", cx: end.x, cy: end.y, r: 4 }),
    );
  });
})();
