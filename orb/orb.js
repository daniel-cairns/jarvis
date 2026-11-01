// Draws the orb and handles Jarvis's messages. States: idle, listening, thinking, speaking.
(() => {
  const canvas = document.getElementById("orb");
  const ctx = canvas.getContext("2d");
  const talk = document.getElementById("talk");
  const stateLabel = document.getElementById("state");
  const card = document.getElementById("card");
  const caption = document.getElementById("caption");
  const status = document.getElementById("status");
  const ask = document.getElementById("ask");
  const askQ = document.getElementById("ask-q");
  const askD = document.getElementById("ask-d");

  const bridge = window.jarvis ?? { onMessage() {}, send() {} };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SIZE = 260;
  const R = 46;
  const SHARDS = 9;
  const COLOURS = {
    idle: [95, 190, 255],
    listening: [110, 255, 205],
    thinking: [175, 145, 255],
    speaking: [125, 220, 255],
  };
  const LABELS = { idle: "Idle", listening: "Listening…", thinking: "Working…", speaking: "Speaking" };
  const TALK_LABELS = { listening: "Stop listening" };

  let state = "idle";
  let colour = [...COLOURS.idle];
  let level = 0;
  let spin = 0;
  let spread = 0;
  let envelope = [];
  let envelopeStart = 0;
  let frameMs = 1000 / 60;
  let askId = null;
  let captionTimer = 0;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);

  const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
  const lerp = (a, b, t) => a + (b - a) * t;

  function setState(next) {
    if (!COLOURS[next]) return;
    state = next;
    stateLabel.textContent = LABELS[next];
    talk.setAttribute("aria-label", TALK_LABELS[next] ?? "Talk to Jarvis");
  }

  function showCaption(text, role) {
    card.hidden = false;
    if (role === "status") status.textContent = text;
    else {
      caption.textContent = role === "you" ? `You: ${text}` : text;
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

  talk.addEventListener("click", () => bridge.send({ type: "talk" }));
  ask.addEventListener("click", (e) => {
    const value = e.target.closest("[data-answer]")?.dataset.answer;
    if (value) answer(value);
  });
  window.addEventListener("keydown", (e) => {
    if (!askId) return;
    const key = e.key.toLowerCase();
    if (key === "y") answer("yes");
    else if (key === "a") answer("always");
    else if (key === "n" || key === "escape") answer("no");
  });

  /** A kite-shaped shard pointing outwards, centred on (x, y) at angle a. */
  function shard(x, y, a, len, wid, fill, edge) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(len * 0.6, 0);
    ctx.lineTo(0, wid / 2);
    ctx.lineTo(-len * 0.4, 0);
    ctx.lineTo(0, -wid / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  function draw(now) {
    const t = now / 1000;
    const c = SIZE / 2;
    const target = COLOURS[state];
    colour = colour.map((v, i) => lerp(v, target[i], 0.06));

    let voice = 0;
    if (state === "speaking" && envelope.length) {
      const i = Math.floor((now - envelopeStart) / frameMs);
      voice = i >= 0 && i < envelope.length ? envelope[i] : 0;
    }
    level = lerp(level, voice, voice > level ? 0.5 : 0.18);

    const motion = reducedMotion ? 0.2 : 1;
    const spinRate = state === "thinking" ? 1.6 : state === "listening" ? 0.6 : 0.25;
    spin += spinRate * motion * 0.016;
    spread = lerp(spread, state === "speaking" ? 10 + level * 16 : state === "thinking" ? 6 : 0, 0.12);

    const breathe = reducedMotion ? 0 : Math.sin(t * 1.5) * 0.035;
    const r = R * (1 + breathe + level * 0.3);

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Halo
    const halo = ctx.createRadialGradient(c, c, r * 0.3, c, c, r * 2.6);
    halo.addColorStop(0, rgba(colour, 0.35 + level * 0.35));
    halo.addColorStop(0.45, rgba(colour, 0.1 + level * 0.12));
    halo.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Listening ripples
    if (state === "listening") {
      for (let k = 0; k < 3; k++) {
        const phase = ((t * 0.7 * motion) + k / 3) % 1;
        ctx.beginPath();
        ctx.arc(c, c, r * (1.1 + phase * 1.3), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(colour, (1 - phase) * 0.45);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Orbiting shards
    for (let i = 0; i < SHARDS; i++) {
      const a = spin + (i * Math.PI * 2) / SHARDS;
      const wobble = state === "thinking" ? Math.sin(t * 3 + i) * 3 : 0;
      const dist = r * 1.42 + spread + wobble;
      shard(c + Math.cos(a) * dist, c + Math.sin(a) * dist, a, 22 + level * 6, 9,
        rgba(colour, 0.22 + level * 0.3), rgba([235, 248, 255], 0.35 + level * 0.3));
    }

    // Core
    const core = ctx.createRadialGradient(c - r * 0.25, c - r * 0.3, r * 0.05, c, c, r);
    core.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    core.addColorStop(0.35, rgba(colour.map((v) => lerp(v, 255, 0.55)), 0.95));
    core.addColorStop(0.85, rgba(colour, 0.75));
    core.addColorStop(1, rgba(colour, 0));
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    // Inner ring
    ctx.beginPath();
    ctx.arc(c, c, r * 0.62, spin * -1.5, spin * -1.5 + Math.PI * 1.4);
    ctx.strokeStyle = rgba([255, 255, 255], 0.35 + level * 0.4);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    requestAnimationFrame(draw);
  }

  setState("idle");
  requestAnimationFrame(draw);
})();
