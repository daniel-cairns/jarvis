// Draws the orb and handles Astra's messages. States: idle, listening, thinking, speaking.
(() => {
  const canvas = document.getElementById("orb");
  const ctx = canvas.getContext("2d");
  const talk = document.getElementById("talk");
  const stopButton = document.getElementById("stop");
  const stateLabel = document.getElementById("state");
  const card = document.getElementById("card");
  const caption = document.getElementById("caption");
  const status = document.getElementById("status");
  const ask = document.getElementById("ask");
  const askQ = document.getElementById("ask-q");
  const askD = document.getElementById("ask-d");
  const captionLabel = document.getElementById("caption-label");
  const captionSpoken = document.getElementById("caption-spoken");

  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Arc reactor meets the winged sun: turquoise reactor light, lapis and gold.
  const W = 320;
  const H = 260;
  const R = 34;
  const GOLD = [236, 188, 82];
  const LAPIS = [34, 64, 160];
  const COLOURS = {
    idle: [70, 200, 230],
    listening: [90, 255, 200],
    thinking: [240, 196, 96],
    speaking: [130, 235, 255],
  };
  const EYE_OPEN = { idle: 0.85, listening: 1, thinking: 0.75, speaking: 0.9 };
  const GLYPHS = ["ankh", "eye", "water", "djed", "sun", "reed"];
  const LABELS = { idle: "Idle", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking" };
  const TALK_LABELS = { listening: "Stop listening" };

  let state = "idle";
  let colour = [...COLOURS.idle];
  let level = 0;
  let spin = 0;
  let wingOpen = 0.6;
  let eye = 0.25;
  let envelope = [];
  let envelopeStart = 0;
  let frameMs = 1000 / 60;
  let askId = null;
  let captionTimer = 0;
  let nextBlink = 3000;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a))})`;
  const lerp = (a, b, t) => a + (b - a) * t;

  function setState(next) {
    if (!COLOURS[next]) return;
    state = next;
    stateLabel.textContent = LABELS[next];
    stopButton.disabled = next === "idle";
    talk.setAttribute("aria-label", TALK_LABELS[next] ?? "Talk to Astra");
  }

  let typing = 0;

  /** Types text out a few characters per frame; the full text is set for screen readers straight away. */
  function typeOut(el, text) {
    cancelAnimationFrame(typing);
    if (reducedMotion) {
      el.textContent = text;
      return;
    }
    let shown = 0;
    const step = () => {
      shown = Math.min(text.length, shown + 3);
      el.textContent = text.slice(0, shown);
      if (shown < text.length) typing = requestAnimationFrame(step);
    };
    step();
  }

  function showCaption(text, role) {
    card.hidden = false;
    if (role === "status") status.textContent = text;
    else {
      captionLabel.textContent = role === "you" ? "You" : "Transmission";
      card.dataset.role = role;
      captionSpoken.textContent = text;
      typeOut(caption, text);
      status.textContent = "";
    }
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => {
      if (state === "idle") card.hidden = true;
    }, 12000);
  }

  function showAsk(m) {
    askId = m.id;
    askQ.textContent = m.spoken;
    askD.textContent = m.detail;
    ask.hidden = false;
    ask.querySelector("[data-answer='yes']").focus();
  }

  function hideAsk(id) {
    if (id !== undefined && id !== askId) return;
    askId = null;
    ask.hidden = true;
  }

  function answer(value) {
    if (!askId) return;
    bridge.send({ type: "answer", id: askId, answer: value });
    hideAsk();
  }

  bridge.onMessage((m) => {
    if (m.type === "state") setState(m.state);
    else if (m.type === "utterance") {
      envelope = Array.isArray(m.envelope) ? m.envelope : [];
      frameMs = m.frameMs || frameMs;
      envelopeStart = performance.now();
      if (m.text) showCaption(m.text, "jarvis");
    } else if (m.type === "caption") showCaption(m.text, m.role);
    else if (m.type === "ask") showAsk(m);
    else if (m.type === "answered") hideAsk(m.id);
  });

  document.getElementById("minimise").addEventListener("click", () => bridge.send({ type: "minimise" }));

  /**
   * Press-and-move drags the window (the main process follows the cursor). A press that barely moves is a click,
   * so the core can be dragged and still talks when tapped.
   */
  function draggable(el, onTap) {
    let press = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      press = { x: e.screenX, y: e.screenY, moved: false };
      canvas.classList.add("dragging");
      bridge.send({ type: "drag-start" });
    });
    el.addEventListener("pointermove", (e) => {
      if (press && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) press.moved = true;
    });
    const end = (tapped) => {
      if (!press) return;
      const wasTap = tapped && !press.moved;
      press = null;
      canvas.classList.remove("dragging");
      bridge.send({ type: "drag-end" });
      if (wasTap) onTap?.();
    };
    el.addEventListener("pointerup", () => end(true));
    el.addEventListener("pointercancel", () => end(false));
    el.addEventListener("lostpointercapture", () => end(false));
  }
  draggable(canvas);
  draggable(talk, () => bridge.send({ type: "talk" }));
  // Keyboard activation (Enter/Space) arrives as a click with no pointer press.
  talk.addEventListener("click", (e) => {
    if (e.detail === 0) bridge.send({ type: "talk" });
  });
  ask.addEventListener("click", (e) => {
    const value = e.target.closest("[data-answer]")?.dataset.answer;
    if (value) answer(value);
  });
  stopButton.addEventListener("click", () => bridge.send({ type: "stop" }));
  // The glyphs on the lower wings glow under the pointer (the glow is drawn on the canvas, under the buttons).
  let hovered = null;
  for (const [el, id] of [[stopButton, "stop"], [document.getElementById("minimise"), "minimise"]]) {
    el.addEventListener("pointerenter", () => (hovered = id));
    el.addEventListener("pointerleave", () => (hovered = null));
    el.addEventListener("focus", () => (hovered = id));
    el.addEventListener("blur", () => (hovered = null));
  }

  window.addEventListener("keydown", (e) => {
    if (!askId) {
      if (e.key === "Escape") bridge.send({ type: "stop" });
      return;
    }
    const key = e.key.toLowerCase();
    if (key === "y") answer("yes");
    else if (key === "a") answer("always");
    else if (key === "n" || key === "escape") answer("no");
  });

  /** One wing of the winged sun: tiers of gold feathers along an upturned spine, drawn to the right of the origin. */
  function wing(open, voice) {
    const span = 62 + open * 26 + voice * 14;
    const lift = 10 + open * 8 + voice * 12;
    const tiers = [
      { h: 8, len: span, alpha: 0.95 },
      { h: 10, len: span * 0.8, alpha: 0.8 },
      { h: 13, len: span * 0.58, alpha: 0.65 },
    ];
    let top = -7;
    for (const tier of tiers) {
      for (let x = 0; x < tier.len; x += 6) {
        const f = x / span;
        const y = top - f * f * lift;
        const fade = 1 - (x / tier.len) * 0.55;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 5, y - 0.8);
        ctx.lineTo(x + 3.8, y + tier.h);
        ctx.lineTo(x - 1.2, y + tier.h - 0.8);
        ctx.closePath();
        ctx.fillStyle = rgba(GOLD, tier.alpha * fade * (0.6 + voice * 0.4));
        ctx.fill();
      }
      ctx.beginPath();
      for (let x = 0; x <= tier.len; x += 4) {
        const f = x / span;
        ctx.lineTo(x, top + tier.h - f * f * lift);
      }
      ctx.strokeStyle = rgba(LAPIS, 0.7);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      top += tier.h - 1;
    }
  }

  /** Small line-drawn symbols for the rotating ring. Ancient forms, drawn fresh here. */
  function glyph(kind, s) {
    ctx.beginPath();
    switch (kind) {
      case "ankh":
        ctx.ellipse(0, -s * 0.45, s * 0.28, s * 0.38, 0, 0, Math.PI * 2);
        ctx.moveTo(0, -s * 0.07); ctx.lineTo(0, s);
        ctx.moveTo(-s * 0.5, s * 0.1); ctx.lineTo(s * 0.5, s * 0.1);
        break;
      case "eye":
        ctx.moveTo(-s * 0.7, 0); ctx.quadraticCurveTo(0, -s * 0.6, s * 0.7, 0); ctx.quadraticCurveTo(0, s * 0.45, -s * 0.7, 0);
        ctx.moveTo(s * 0.18, 0); ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
        ctx.moveTo(-s * 0.1, s * 0.3); ctx.lineTo(-s * 0.25, s * 0.9);
        break;
      case "water":
        for (let row = -1; row <= 1; row++) {
          ctx.moveTo(-s * 0.7, row * s * 0.4);
          for (let i = 0; i < 4; i++) ctx.lineTo(-s * 0.7 + (i + 0.5) * s * 0.35, row * s * 0.4 + (i % 2 ? 0.18 : -0.18) * s);
        }
        break;
      case "djed":
        ctx.moveTo(0, -s); ctx.lineTo(0, s);
        for (let i = 0; i < 3; i++) { ctx.moveTo(-s * 0.45, -s * 0.8 + i * s * 0.32); ctx.lineTo(s * 0.45, -s * 0.8 + i * s * 0.32); }
        ctx.moveTo(-s * 0.4, s); ctx.lineTo(s * 0.4, s);
        break;
      case "sun":
        ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
        ctx.moveTo(s * 0.12, 0); ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
        break;
      default: // reed
        ctx.moveTo(0, s); ctx.lineTo(0, -s * 0.3);
        ctx.moveTo(0, -s * 0.3); ctx.quadraticCurveTo(s * 0.5, -s * 0.6, s * 0.15, -s);
        ctx.quadraticCurveTo(-s * 0.2, -s * 0.6, 0, -s * 0.3);
    }
    ctx.stroke();
  }

  /**
   * A small pair of wings just below the eye, holding the two controls: stop (house glyph) on the left wing, minimise
   * (water glyph) on the right. The DOM buttons sit on the wings; this draws the wings and the glow behind each glyph.
   */
  function lowerWings(cx, t, busy, hover) {
    for (const side of [1, -1]) {
      ctx.save();
      ctx.translate(cx + side * 8, 207);
      ctx.scale(side * 0.6, 0.6);
      ctx.rotate(0.14);
      wing(0.6, level * 0.5);
      ctx.restore();
    }
    for (const [id, x] of [["stop", cx - 26], ["minimise", cx + 26]]) {
      const busyStop = id === "stop" && busy;
      const lit = (hover === id ? 1 : 0) + (busyStop ? 0.55 + 0.3 * Math.sin(t * 4) : 0);
      if (lit <= 0) continue;
      const glow = ctx.createRadialGradient(x, 213, 0, x, 213, 16);
      glow.addColorStop(0, rgba(busyStop ? [255, 110, 90] : GOLD, 0.45 * Math.min(1, lit)));
      glow.addColorStop(1, rgba(busyStop ? [255, 110, 90] : GOLD, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(x - 16, 197, 32, 32);
    }
  }

  /** The Eye of Horus in the core; `open` 0..1 squashes it shut. */
  function horusEye(open) {
    const s = R * 0.55;
    ctx.save();
    ctx.scale(1, Math.max(0.06, open));
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.quadraticCurveTo(0, -s * 0.95, s, 0);
    ctx.quadraticCurveTo(0, s * 0.75, -s, 0);
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.fill();
    ctx.strokeStyle = rgba(LAPIS, 0.95);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = rgba(LAPIS, 0.95);
    ctx.fill();
    ctx.restore();
    if (open < 0.3) return;
    ctx.save();
    ctx.globalAlpha = (open - 0.3) / 0.7;
    ctx.strokeStyle = rgba(LAPIS, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath(); // brow
    ctx.moveTo(-s * 1.05, -s * 0.62 * open); ctx.quadraticCurveTo(0, -s * 1.15 * open, s * 1.05, -s * 0.55 * open);
    ctx.moveTo(-s * 0.1, s * 0.35 * open); ctx.lineTo(-s * 0.3, s * 1.05); // teardrop
    ctx.moveTo(s * 0.3, s * 0.3 * open); ctx.quadraticCurveTo(s * 0.55, s * 1.1, s * 0.95, s * 0.8); // spiral tail
    ctx.arc(s * 0.82, s * 0.68, s * 0.14, Math.PI * 0.2, Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();
  }

  function draw(now) {
    const t = now / 1000;
    const cx = W / 2;
    const cy = H / 2 + 6;
    const target = COLOURS[state];
    colour = colour.map((v, i) => lerp(v, target[i], 0.06));

    let voice = 0;
    if (state === "speaking" && envelope.length) {
      const i = Math.floor((now - envelopeStart) / frameMs);
      voice = i >= 0 && i < envelope.length ? envelope[i] : 0;
    }
    level = lerp(level, voice, voice > level ? 0.5 : 0.18);

    const motion = reducedMotion ? 0.2 : 1;
    spin += (state === "thinking" ? 1.4 : state === "listening" ? 0.5 : 0.18) * motion * 0.016;
    wingOpen = lerp(wingOpen, state === "speaking" ? 1 : state === "listening" ? 0.85 : state === "thinking" ? 0.7 : 0.5, 0.05);

    let eyeTarget = EYE_OPEN[state];
    if (state === "idle" && !reducedMotion && now > nextBlink) {
      eyeTarget = 0;
      if (now > nextBlink + 140) nextBlink = now + 3500 + Math.random() * 4000;
    }
    eye = lerp(eye, eyeTarget, 0.2);

    const breathe = reducedMotion ? 0 : Math.sin(t * 1.5) * 0.03;
    const r = R * (1 + breathe + level * 0.22);

    ctx.clearRect(0, 0, W, H);

    // Halo: reactor light with a warm gold rim
    const halo = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 3.2);
    halo.addColorStop(0, rgba(colour, 0.4 + level * 0.35));
    halo.addColorStop(0.35, rgba(colour, 0.12 + level * 0.12));
    halo.addColorStop(0.6, rgba(GOLD, 0.05 + level * 0.06));
    halo.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // Sun rays while speaking
    if (level > 0.03) {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + spin * 0.3;
        const len = 8 + level * 34 * (0.6 + 0.4 * Math.sin(i * 2.3 + t * 4));
        const r0 = r * 1.95;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        ctx.strokeStyle = rgba(GOLD, level * 0.55);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Wings
    for (const side of [1, -1]) {
      ctx.save();
      ctx.translate(cx + side * r * 1.55, cy);
      ctx.scale(side, 1);
      wing(wingOpen, level);
      ctx.restore();
    }

    // Listening ripples
    if (state === "listening") {
      for (let k = 0; k < 3; k++) {
        const phase = (t * 0.7 * motion + k / 3) % 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r * (1.2 + phase * 1.6), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(colour, (1 - phase) * 0.4);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Glyph ring: gold double ring with symbols, turning slowly
    const gr = r * 1.72;
    ctx.strokeStyle = rgba(GOLD, 0.55);
    ctx.lineWidth = 1;
    for (const rr of [gr - 7, gr + 7]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(GOLD, 0.85);
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) {
      const a = spin * 0.6 + (i / 12) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * gr, cy + Math.sin(a) * gr);
      ctx.rotate(a + Math.PI / 2);
      glyph(GLYPHS[i % GLYPHS.length], 4.2);
      ctx.restore();
    }

    // Reactor ring: segmented light, chasing while working
    const sr = r * 1.28;
    for (let i = 0; i < 10; i++) {
      const a0 = -spin * 1.2 + (i / 10) * Math.PI * 2;
      const chase = state === "thinking" ? 0.35 + 0.65 * Math.max(0, Math.cos(t * 6 - i * 0.63)) : 0.55 + level * 0.45;
      ctx.beginPath();
      ctx.arc(cx, cy, sr, a0 + 0.06, a0 + (Math.PI * 2) / 10 - 0.06);
      ctx.strokeStyle = rgba(colour, chase);
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    // HUD ticks
    for (let i = 0; i < 60; i++) {
      const a = spin * -0.4 + (i / 60) * Math.PI * 2;
      const len = i % 5 === 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (sr + 6), cy + Math.sin(a) * (sr + 6));
      ctx.lineTo(cx + Math.cos(a) * (sr + 6 + len), cy + Math.sin(a) * (sr + 6 + len));
      ctx.strokeStyle = rgba(colour, 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    lowerWings(cx, t, state !== "idle", hovered);

    // Core: white-hot sun disc
    const core = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
    core.addColorStop(0, "rgba(255, 255, 255, 1)");
    core.addColorStop(0.5, rgba(colour.map((v) => lerp(v, 255, 0.6)), 0.98));
    core.addColorStop(0.9, rgba(colour, 0.85));
    core.addColorStop(1, rgba(colour, 0));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(GOLD, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy - 1);
    horusEye(eye);
    ctx.restore();

    requestAnimationFrame(draw);
  }

  setState("idle");
  requestAnimationFrame(draw);
})();
