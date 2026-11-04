// Her beam on the control overlay: a gentle stream of ether from the orb's core to the window she's working in (see
// sendBeam in main.cjs). Coordinates arrive in this window's own points. The stream ends on the window's edge nearest
// the orb. A pale, slowly drifting haze (turbulence over soft wide strokes), a few faint wisps that sway smoothly
// through it, and a soft glow breathing at each end. With reduced motion it's drawn once and stays still.
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

  // Made once: the slow turbulence that makes the haze drift, a softer blur for the wisps, and the glow at each end.
  const whole = { filterUnits: "userSpaceOnUse", x: 0, y: 0, width: "100%", height: "100%" };
  const defs = el("defs", {}, [
    el("filter", { id: "ether", ...whole }, [
      el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.012 0.03", numOctaves: 2, seed: 7, result: "noise" }, still ? [] : [
        el("animate", { attributeName: "baseFrequency", dur: "16s", values: "0.012 0.03;0.016 0.022;0.012 0.03", repeatCount: "indefinite" }),
      ]),
      el("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale: 28, xChannelSelector: "R", yChannelSelector: "G" }),
      el("feGaussianBlur", { stdDeviation: 10 }),
    ]),
    el("filter", { id: "wisp", ...whole }, [el("feGaussianBlur", { stdDeviation: 1.6 })]),
    el("radialGradient", { id: "aura" }, [
      el("stop", { offset: "0", "stop-color": "#f4fbff", "stop-opacity": 0.85 }),
      el("stop", { offset: "0.4", "stop-color": "#a9dcff", "stop-opacity": 0.4 }),
      el("stop", { offset: "1", "stop-color": "#b9a8ff", "stop-opacity": 0 }),
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

  /**
   * A wisp from a to b: a smooth curve that sways sideways in slow waves, pinned at both ends. `phase` and `time`
   * move the waves, so it drifts rather than flickers.
   */
  const wisp = (a, b, sway, waves, phase, time) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const steps = Math.max(12, Math.round(len / 14));
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = sway * Math.sin(Math.PI * t) * Math.sin(2 * Math.PI * waves * t + phase + time);
      d += `${i ? "L" : "M"}${(a.x + dx * t + nx * off).toFixed(1)},${(a.y + dy * t + ny * off).toFixed(1)}`;
    }
    return d;
  };

  const WISPS = [
    { sway: 9, waves: 1.5, phase: 0, speed: 0.7, colour: "#eef8ff", width: 1.4, opacity: 0.55 },
    { sway: 15, waves: 1, phase: 2.1, speed: -0.5, colour: "#bfe3ff", width: 1, opacity: 0.4 },
    { sway: 22, waves: 2, phase: 4.2, speed: 0.35, colour: "#d2c6ff", width: 0.9, opacity: 0.3 },
  ];

  let current = null;

  function draw(time) {
    if (!current) return;
    const { from, to, end } = current;
    const breathe = still ? 1 : 0.85 + 0.15 * Math.sin(time * 1.3);
    layer.replaceChildren(
      // The window she's in: a faint, soft rim.
      el("rect", { x: to.x + 1, y: to.y + 1, width: Math.max(0, to.width - 2), height: Math.max(0, to.height - 2), rx: 12, fill: "rgba(150,200,255,0.03)", stroke: "rgba(170,210,255,0.32)", "stroke-width": 2, filter: "url(#wisp)" }),
      // The haze: two wide, pale strokes, drifting.
      el("line", { x1: from.x, y1: from.y, x2: end.x, y2: end.y, stroke: "rgba(185,168,255,0.22)", "stroke-width": 64, "stroke-linecap": "round", filter: "url(#ether)" }),
      el("line", { x1: from.x, y1: from.y, x2: end.x, y2: end.y, stroke: "rgba(150,210,255,0.3)", "stroke-width": 26, "stroke-linecap": "round", filter: "url(#ether)" }),
      ...WISPS.map((w) =>
        el("path", {
          d: wisp(from, end, w.sway, w.waves, w.phase, time * w.speed),
          fill: "none",
          stroke: w.colour,
          "stroke-width": w.width,
          "stroke-opacity": w.opacity,
          "stroke-linecap": "round",
          filter: "url(#wisp)",
        }),
      ),
      el("circle", { cx: from.x, cy: from.y, r: 20 * breathe, fill: "url(#aura)" }),
      el("circle", { cx: end.x, cy: end.y, r: 16 * breathe, fill: "url(#aura)" }),
    );
  }

  /** About 30 times a second: the wisps sway and the ends breathe. */
  let last = 0;
  function loop(now) {
    if (!current) return;
    if (now - last > 33) {
      last = now;
      draw(now / 1000);
    }
    requestAnimationFrame(loop);
  }

  bridge.onMessage((m) => {
    if (m.type !== "beam") return;
    const was = current;
    current = m.from && m.to ? { from: m.from, to: m.to, end: landing(m.from, m.to) } : null;
    if (!current) return layer.replaceChildren();
    draw(performance.now() / 1000);
    if (!was && !still) requestAnimationFrame(loop);
  });
})();
