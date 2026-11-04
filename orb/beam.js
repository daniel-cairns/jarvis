// Her beam on the control overlay: a plasma cloud streaming from the orb's core to the window she's working in (see
// sendBeam in main.cjs). Coordinates arrive in this window's own points. The stream ends on the window's edge nearest
// the orb. A churning body (turbulence over a soft wide stroke), bright tendrils that crackle inside it, and a glowing
// ball at each end. With reduced motion it's drawn once and stays still.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("beam");
  const bridge = window.jarvis ?? { onMessage() {} };
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (name, attrs = {}, kids = []) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    node.append(...kids);
    return node;
  };

  // Filters and gradients, made once: the turbulence that makes the body churn, and the soft ball at each end.
  const defs = el("defs", {}, [
    el("filter", { id: "plasma", filterUnits: "userSpaceOnUse", x: 0, y: 0, width: "100%", height: "100%" }, [
      el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.018 0.05", numOctaves: 3, seed: 4, result: "noise" }, still ? [] : [
        el("animate", { attributeName: "baseFrequency", dur: "6s", values: "0.018 0.05;0.026 0.035;0.018 0.05", repeatCount: "indefinite" }),
      ]),
      el("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale: 50, xChannelSelector: "R", yChannelSelector: "G" }),
      el("feGaussianBlur", { stdDeviation: 5 }),
    ]),
    el("filter", { id: "glow", filterUnits: "userSpaceOnUse", x: 0, y: 0, width: "100%", height: "100%" }, [el("feGaussianBlur", { stdDeviation: 2.2 })]),
    el("radialGradient", { id: "ball" }, [
      el("stop", { offset: "0", "stop-color": "#f2fbff", "stop-opacity": 1 }),
      el("stop", { offset: "0.35", "stop-color": "#7cc4ff", "stop-opacity": 0.85 }),
      el("stop", { offset: "1", "stop-color": "#6a5cff", "stop-opacity": 0 }),
    ]),
  ]);
  const layer = el("g");
  svg.replaceChildren(defs, layer);

  /** Where the stream first meets the rectangle: the nearest point on its edge (its centre if `p` is inside). */
  const landing = (p, r) => {
    const inside = p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
    if (inside) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    return { x: Math.min(Math.max(p.x, r.x), r.x + r.width), y: Math.min(Math.max(p.y, r.y), r.y + r.height) };
  };

  /** A wandering thread from a to b: points along the line, pushed sideways by up to `spread`, pinned at both ends. */
  const tendril = (a, b, spread) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const steps = Math.max(6, Math.round(len / 26));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pinch = Math.sin(Math.PI * t); // no wander at the ends
      const off = (Math.random() * 2 - 1) * spread * pinch;
      pts.push(`${(a.x + dx * t + nx * off).toFixed(1)},${(a.y + dy * t + ny * off).toFixed(1)}`);
    }
    return `M${pts.join(" L")}`;
  };

  let frame = 0;
  let current = null;

  function draw() {
    if (!current) return;
    const { from, to, end } = current;
    const threads = [0, 1, 2].map((i) =>
      el("path", {
        d: tendril(from, end, 10 + i * 7),
        fill: "none",
        stroke: i === 0 ? "#eaf7ff" : "#9fd4ff",
        "stroke-width": i === 0 ? 1.6 : 1,
        "stroke-opacity": i === 0 ? 0.95 : 0.7,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        filter: "url(#glow)",
      }),
    );
    layer.replaceChildren(
      // The window she's in: a soft plasma rim rather than a hard box.
      el("rect", { x: to.x + 1, y: to.y + 1, width: Math.max(0, to.width - 2), height: Math.max(0, to.height - 2), rx: 12, fill: "rgba(90,150,255,0.05)", stroke: "rgba(120,180,255,0.55)", "stroke-width": 3, filter: "url(#glow)" }),
      // The cloud: two wide soft strokes churned by turbulence.
      el("line", { x1: from.x, y1: from.y, x2: end.x, y2: end.y, stroke: "rgba(106,92,255,0.45)", "stroke-width": 70, "stroke-linecap": "round", filter: "url(#plasma)" }),
      el("line", { x1: from.x, y1: from.y, x2: end.x, y2: end.y, stroke: "rgba(110,190,255,0.6)", "stroke-width": 30, "stroke-linecap": "round", filter: "url(#plasma)" }),
      ...threads,
      el("circle", { cx: from.x, cy: from.y, r: 26, fill: "url(#ball)" }),
      el("circle", { cx: end.x, cy: end.y, r: 22, fill: "url(#ball)" }),
    );
  }

  /** Redraws the tendrils about 20 times a second, so the plasma crackles. */
  function loop(now) {
    if (!current) return;
    if (now - frame > 50) {
      frame = now;
      draw();
    }
    requestAnimationFrame(loop);
  }

  bridge.onMessage((m) => {
    if (m.type !== "beam") return;
    const was = current;
    current = m.from && m.to ? { from: m.from, to: m.to, end: landing(m.from, m.to) } : null;
    if (!current) return layer.replaceChildren();
    draw();
    if (!was && !still) requestAnimationFrame(loop);
  });
})();
