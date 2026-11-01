// Draws the orb and handles Astra's messages. States: idle, listening, thinking, speaking.
(() => {
  const canvas = document.getElementById("orb");
  let ctx = canvas.getContext("2d");
  // The ring glyph for whatever she's doing right now glows while she works.
  let activeGlyph = null;
  let activeGlyphAt = 0;
  const talk = document.getElementById("talk");
  const stopButton = document.getElementById("stop");
  const stateLabel = document.getElementById("state");
  const card = document.getElementById("card");
  const caption = document.getElementById("caption");
  const activity = document.getElementById("activity");
  const cardToggle = document.getElementById("card-toggle");
  const question = document.getElementById("question");
  const questionQ = document.getElementById("question-q");
  const questionOptions = document.getElementById("question-options");
  const questionOther = document.getElementById("question-other");
  const questionText = document.getElementById("question-text");
  const questionDoneRow = document.getElementById("question-done-row");
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

  // ── Gate dial: on each state change the glyph ring dials like a stargate ──
  // The ring spins and settles on a symbol, the top chevron engages and the next chevron round lights; it reverses
  // for the next symbol, three locks in all, then the lit chevrons flare and a burst ripples out from the eye.
  const CHEVRONS = 9;
  const LOCKS = 3;
  const SPIN_MS = 420;
  const ENGAGE_MS = 230;
  const BURST_MS = 650;
  const FADE_MS = 900;
  const LOCK_MS = SPIN_MS + ENGAGE_MS;
  const DIAL_MS = LOCKS * LOCK_MS;
  let ringOffset = 0;
  let dialFrom = 0;
  let dialAt = -Infinity;
  let dialing = false;
  const easeInOut = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
  // How far each lock's spin travels (in glyph slots of 30°), alternating direction like a gate dialling.
  const spinFor = (k) => (k % 2 === 0 ? 1 : -1) * (Math.PI / 6) * (5 + k * 2);

  function startUnlock() {
    if (reducedMotion) return;
    if (dialing) ringOffset = dialFrom + [0, 1, 2].reduce((sum, k) => sum + spinFor(k), 0);
    dialFrom = ringOffset;
    dialAt = performance.now();
    dialing = true;
  }

  /** This frame's ring offset, top-chevron engage (0..1), chevrons lit, burst (0..1) and lit-chevron fade (0..1). */
  function unlockFrame(now) {
    const e = now - dialAt;
    if (!dialing && e > DIAL_MS + BURST_MS + FADE_MS) return { offset: ringOffset, engage: 0, lit: 0, burst: 0, glow: 0 };
    if (e >= DIAL_MS) {
      if (dialing) {
        ringOffset = dialFrom + [0, 1, 2].reduce((sum, k) => sum + spinFor(k), 0);
        dialing = false;
      }
      const after = e - DIAL_MS;
      return {
        offset: ringOffset,
        engage: 0,
        lit: LOCKS,
        burst: after < BURST_MS ? after / BURST_MS : 0,
        glow: after < BURST_MS ? 1 : Math.max(0, 1 - (after - BURST_MS) / FADE_MS),
      };
    }
    const k = Math.floor(e / LOCK_MS);
    const within = e - k * LOCK_MS;
    let offset = dialFrom;
    for (let j = 0; j < k; j++) offset += spinFor(j);
    if (within < SPIN_MS) offset += spinFor(k) * easeInOut(within / SPIN_MS);
    else offset += spinFor(k);
    const engage = within >= SPIN_MS ? Math.sin(((within - SPIN_MS) / ENGAGE_MS) * Math.PI) : 0;
    return { offset, engage, lit: k + (within >= SPIN_MS + ENGAGE_MS / 2 ? 1 : 0), burst: 0, glow: 1 };
  }

  /** A chevron: a gold V-wedge pointing in at the ring, lit or dim. */
  function chevron(lit, dip) {
    ctx.beginPath();
    ctx.moveTo(-6, -4 + dip);
    ctx.lineTo(0, 3 + dip);
    ctx.lineTo(6, -4 + dip);
    ctx.lineTo(3.2, -5.5 + dip);
    ctx.lineTo(0, -1 + dip);
    ctx.lineTo(-3.2, -5.5 + dip);
    ctx.closePath();
    if (lit > 0) {
      ctx.fillStyle = rgba([255, 228, 150], 0.35 + 0.6 * lit);
      ctx.shadowColor = rgba(COLOURS.listening, 0.9 * lit);
      ctx.shadowBlur = 10 * lit;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = rgba(GOLD, 0.4 + 0.6 * Math.max(lit, 0));
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function setState(next) {
    if (!COLOURS[next]) return;
    if (next !== state) startUnlock();
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

  /** What she's doing, newest last: the current step marked live, earlier ones ticked off. Keeps the last four. */
  /** A small line-art glyph for the activity feed, drawn with the same strokes as the ring's. */
  function glyphIcon(kind) {
    const c = document.createElement("canvas");
    c.width = 28;
    c.height = 28;
    c.className = "glyph";
    c.setAttribute("aria-hidden", "true");
    const g = c.getContext("2d");
    g.translate(14, 14);
    g.strokeStyle = "#ecbc52";
    g.lineWidth = 2.2;
    g.lineCap = "round";
    const saved = ctx;
    ctx = g;
    glyph(kind, 9);
    ctx = saved;
    return c;
  }

  function addActivity(text, kind = "sun") {
    card.hidden = false;
    activeGlyph = kind;
    activeGlyphAt = performance.now();
    const last = activity.lastElementChild;
    if (last && last.dataset.text === text) return;
    for (const li of activity.children) li.className = "done";
    const li = document.createElement("li");
    li.className = "current";
    li.dataset.text = text;
    const label = document.createElement("span");
    label.textContent = text;
    li.append(glyphIcon(kind), label);
    activity.append(li);
    while (activity.children.length > 4) activity.firstElementChild.remove();
    keepCard();
  }

  // Collapsing the thinking window leaves one line: her current step. Remembered between runs (per this Mac).
  function setCollapsed(collapsed) {
    card.classList.toggle("collapsed", collapsed);
    document.body.classList.toggle("collapsed", collapsed);
    stateLabel.setAttribute("aria-expanded", String(!collapsed));
    cardToggle.setAttribute("aria-expanded", String(!collapsed));
    cardToggle.setAttribute("aria-label", collapsed ? "Expand her thinking window" : "Collapse her thinking window");
    cardToggle.title = collapsed ? "Expand" : "Collapse";
    cardToggle.textContent = collapsed ? "▸" : "▾";
    try {
      localStorage.setItem("astra.cardCollapsed", collapsed ? "1" : "0");
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  }
  cardToggle.addEventListener("click", () => setCollapsed(!card.classList.contains("collapsed")));
  // The state label under the orb toggles the panel too: with it collapsed, it's the way back.
  const toggleFromLabel = () => setCollapsed(!card.classList.contains("collapsed"));
  stateLabel.addEventListener("click", toggleFromLabel);
  stateLabel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleFromLabel();
    }
  });
  try {
    setCollapsed(localStorage.getItem("astra.cardCollapsed") === "1");
  } catch {
    setCollapsed(false);
  }

  function resetActivity() {
    activity.replaceChildren();
    caption.textContent = "";
    captionSpoken.textContent = "";
  }

  function keepCard() {
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => {
      if (state === "idle") card.hidden = true;
    }, 12000);
  }

  function showCaption(text, role) {
    if (role === "status") return addActivity(text);
    card.hidden = false;
    captionLabel.textContent = role === "you" ? "You" : "Transmission";
    card.dataset.role = role;
    captionSpoken.textContent = text;
    typeOut(caption, text);
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

  // ── Questions (ask_user): options to click or press 1–9, Done for several, or a typed answer ──
  let questionId = null;
  let questionMulti = false;
  let questionLabels = [];
  const picked = new Set();

  function showQuestion(m) {
    questionId = m.id;
    questionMulti = !!m.multiSelect;
    questionLabels = (m.options || []).map((o) => o.label);
    picked.clear();
    questionQ.textContent = m.question;
    questionOptions.replaceChildren(
      ...(m.options || []).map((o, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.index = String(i);
        b.textContent = `${i + 1}. ${o.label}`;
        if (o.description) b.title = o.description;
        if (questionMulti) b.setAttribute("aria-pressed", "false");
        return b;
      }),
    );
    questionOther.hidden = !(m.allowOther || !questionLabels.length);
    questionText.value = "";
    questionDoneRow.hidden = !questionMulti;
    question.hidden = false;
    (questionOptions.firstElementChild || questionText).focus();
  }

  function hideQuestion(id) {
    if (id !== undefined && id !== questionId) return;
    questionId = null;
    question.hidden = true;
  }

  function answerQuestion(answerValue) {
    if (!questionId) return;
    bridge.send({ type: "question-answer", id: questionId, answer: answerValue });
    hideQuestion();
  }

  function pickOption(i) {
    const label = questionLabels[i];
    if (label === undefined) return;
    if (!questionMulti) return answerQuestion([label]);
    picked.has(i) ? picked.delete(i) : picked.add(i);
    questionOptions.children[i]?.setAttribute("aria-pressed", String(picked.has(i)));
  }

  questionOptions.addEventListener("click", (e) => {
    const i = e.target.closest("[data-index]")?.dataset.index;
    if (i !== undefined) pickOption(Number(i));
  });
  document.getElementById("question-done").addEventListener("click", () => {
    if (picked.size) answerQuestion([...picked].sort((a, b) => a - b).map((i) => questionLabels[i]));
  });
  questionOther.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = questionText.value.trim();
    if (text) answerQuestion(text);
  });

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
    else if (m.type === "question") showQuestion(m);
    else if (m.type === "answered") {
      hideAsk(m.id);
      hideQuestion(m.id);
    } else if (m.type === "activity") addActivity(m.text, m.glyph);
    else if (m.type === "activity-reset") resetActivity();
    // Transcript mode: "Recording 03:12" in place of "Listening…" until the state changes.
    else if (m.type === "state-label") stateLabel.textContent = m.text;
    else if (m.type === "layout") document.body.classList.toggle("top", !!m.top);
    else if (m.type === "collapse") setCollapsed(!!m.collapsed);
    else if (m.type === "transform") transformTo(m.to);
    else if (m.type === "volume-level" && !m.quiet) showVolume(m.level);
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

  // Volume: scroll over the orb. A gold arc and the label show the level for a moment.
  let volumeLevel = null;
  let volumeShownAt = 0;
  let lastWheel = 0;
  function showVolume(level) {
    volumeLevel = level;
    volumeShownAt = performance.now();
    stateLabel.textContent = `Volume ${Math.round(level * 100)}%`;
    clearTimeout(showVolume.timer);
    showVolume.timer = setTimeout(() => setState(state), 1500);
  }
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheel < 80) return;
      lastWheel = now;
      bridge.send({ type: "volume", delta: e.deltaY < 0 ? 0.05 : -0.05 });
    },
    { passive: false },
  );
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
    if (questionId && e.target !== questionText) {
      if (/^[1-9]$/.test(e.key)) return pickOption(Number(e.key) - 1);
      if (e.key === "Enter" && questionMulti && picked.size) return document.getElementById("question-done").click();
    }
    if (questionId) return;
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
   * Lower wings that wrap the bottom of the glyph ring: three tiers of gold feathers laid along arcs concentric with the
   * ring, so they meet it cleanly and sweep up towards their tips. Stop (left) and minimise (right) sit on them; the
   * DOM buttons are positioned over GLYPH_ANGLE, and this draws the glow behind each glyph.
   */
  const GLYPH_ANGLE = 0.24;
  function lowerWings(cx, cy, ringR, t, busy, hover, glow = 0) {
    const base = ringR + 9; // just outside the ring's outer line
    const tiers = [
      { h: 7, end: 1.08, alpha: 0.95 },
      { h: 8, end: 0.9, alpha: 0.8 },
      { h: 10, end: 0.7, alpha: 0.65 },
    ];
    const step = 0.055;
    for (const side of [1, -1]) {
      let r0 = base;
      for (const tier of tiers) {
        for (let a = 0.06; a < tier.end; a += step) {
          const f = (a - 0.06) / (tier.end - 0.06);
          const h = tier.h * (1 - f * 0.35);
          const th0 = Math.PI / 2 - side * (a - step * 0.42);
          const th1 = Math.PI / 2 - side * (a + step * 0.42);
          const at = (th, r) => [cx + Math.cos(th) * r, cy + Math.sin(th) * r];
          ctx.beginPath();
          ctx.moveTo(...at(th0, r0));
          ctx.lineTo(...at(th1, r0));
          ctx.lineTo(...at(th1 + side * step * 0.15, r0 + h));
          ctx.lineTo(...at(th0 + side * step * 0.15, r0 + h));
          ctx.closePath();
          ctx.fillStyle = rgba(GOLD, tier.alpha * (1 - f * 0.5) * (0.6 + Math.max(level, glow) * 0.4));
          ctx.fill();
        }
        // Lapis line under each tier, following the ring's curve.
        ctx.beginPath();
        if (side === 1) ctx.arc(cx, cy, r0 + tier.h, Math.PI / 2 - tier.end, Math.PI / 2 - 0.06);
        else ctx.arc(cx, cy, r0 + tier.h, Math.PI / 2 + 0.06, Math.PI / 2 + tier.end);
        ctx.strokeStyle = rgba(LAPIS, 0.7);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        r0 += tier.h - 1;
      }
    }
    const glyphR = base + 11;
    for (const [id, side] of [["stop", -1], ["minimise", 1]]) {
      const busyStop = id === "stop" && busy;
      const lit = (hover === id ? 1 : 0) + (busyStop ? 0.55 + 0.3 * Math.sin(t * 4) : 0);
      if (lit <= 0) continue;
      const x = cx + side * Math.sin(GLYPH_ANGLE) * glyphR;
      const y = cy + Math.cos(GLYPH_ANGLE) * glyphR;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 15);
      glow.addColorStop(0, rgba(busyStop ? [255, 110, 90] : GOLD, 0.5 * Math.min(1, lit)));
      glow.addColorStop(1, rgba(busyStop ? [255, 110, 90] : GOLD, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(x - 15, y - 15, 30, 30);
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

  // ── Transform: fold away (close) and unfold (open) ──
  // Closing: the wings fold in, then the rings and chevrons retract into the eye, then the eye closes; opening runs
  // the same stages backwards. `form` is 1 open, 0 closed. The main process waits for "transform-done" before hiding.
  const FORM_MS = 900;
  let formFrom = 0;
  let formTo = 1;
  let formAt = performance.now();
  let formReported = true;
  const smooth = (p) => {
    const c = Math.min(1, Math.max(0, p));
    return c * c * (3 - 2 * c);
  };

  function transformTo(to) {
    const now = performance.now();
    if (to === "closed-now") {
      formFrom = formTo = 0;
      formReported = true;
      return;
    }
    formFrom = currentForm(now);
    formTo = to === "open" ? 1 : 0;
    formAt = reducedMotion ? now - FORM_MS : now;
    formReported = false;
  }

  function currentForm(now) {
    const p = smooth((now - formAt) / FORM_MS);
    return formFrom + (formTo - formFrom) * p;
  }

  /** Each stage's openness (0..1) for a given form: wings, rings, eye. */
  function stages(form) {
    const closing = 1 - form;
    return {
      wings: 1 - smooth(closing / 0.4),
      rings: 1 - smooth((closing - 0.3) / 0.5),
      eye: 1 - smooth((closing - 0.7) / 0.3),
    };
  }

  let shownOpacity = null;

  function draw(now) {
    const t = now / 1000;
    const form = currentForm(now);
    if (!formReported && Math.abs(form - formTo) < 0.001) {
      formReported = true;
      bridge.send({ type: "transform-done", to: formTo === 1 ? "open" : "close" });
    }
    const st = stages(form);
    // The controls and the state label fade with the wings.
    const controlsOpacity = Math.round(st.wings * 20) / 20;
    if (controlsOpacity !== shownOpacity) {
      shownOpacity = controlsOpacity;
      for (const el of [stopButton, document.getElementById("minimise"), stateLabel]) el.style.opacity = String(controlsOpacity);
    }
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

    // Wings (glowing turquoise while she listens)
    const listenGlow = state === "listening" ? 0.65 + (reducedMotion ? 0 : 0.35 * Math.sin(t * 3)) : 0;
    for (const side of [1, -1]) {
      ctx.save();
      if (listenGlow) {
        ctx.shadowColor = rgba(COLOURS.listening, 0.9);
        ctx.shadowBlur = 8 + listenGlow * 12;
      }
      ctx.globalAlpha = st.wings;
      ctx.translate(cx + side * r * 1.55 * (0.4 + 0.6 * st.wings), cy);
      ctx.scale(side * st.wings, 1);
      wing(wingOpen, Math.max(level, listenGlow));
      ctx.restore();
    }

    // Everything from here to the lower wings retracts into the eye as the rings stage closes.
    ctx.save();
    ctx.globalAlpha = st.rings;
    ctx.translate(cx, cy);
    ctx.scale(0.3 + 0.7 * st.rings, 0.3 + 0.7 * st.rings);
    ctx.translate(-cx, -cy);

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

    // Glyph ring: gold double ring with symbols, turning slowly (and dialling like a gate on state changes)
    const gr = r * 1.72;
    const dial = unlockFrame(now);
    ctx.strokeStyle = rgba(GOLD, 0.55);
    ctx.lineWidth = 1;
    for (const rr of [gr - 7, gr + 7]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Burst: a turquoise ripple out from the eye when the last chevron locks.
    if (dial.burst) {
      const rr = r + dial.burst * (gr + 30 - r);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(COLOURS.listening, 0.8 * (1 - dial.burst));
      ctx.lineWidth = 6 * (1 - dial.burst) + 1;
      ctx.stroke();
    }
    // Chevrons round the outside; the top one is the master that engages on each lock. With the thinking window
    // collapsed they also show her state: breathing turquoise while listening, a chase while thinking, lighting
    // outwards from the top with her voice while speaking.
    const showState = card.classList.contains("collapsed") && !reducedMotion;
    const stateLit = (c) => {
      if (!showState) return 0;
      if (state === "listening") return 0.45 + 0.35 * Math.sin(t * 3);
      if (state === "thinking") {
        const head = (t * 7) % CHEVRONS;
        const behind = (head - c + CHEVRONS) % CHEVRONS;
        return behind < 3 ? 1 - behind / 3 : 0;
      }
      if (state === "speaking") {
        const fromTop = Math.min(c, CHEVRONS - c);
        return fromTop <= level * 5 ? 0.5 + level * 0.5 : 0;
      }
      return 0;
    };
    for (let c = 0; c < CHEVRONS; c++) {
      const a = -Math.PI / 2 + (c * Math.PI * 2) / CHEVRONS;
      const dialLit = c === 0 ? Math.max(dial.engage, dial.lit >= LOCKS ? dial.glow : 0) : c <= dial.lit ? dial.glow : 0;
      const lit = Math.max(dialLit, stateLit(c));
      ctx.save();
      ctx.translate(cx + Math.cos(a) * (gr + 13), cy + Math.sin(a) * (gr + 13));
      ctx.rotate(a + Math.PI / 2); // local +y points in at the ring
      chevron(lit, c === 0 ? 3 * dial.engage : 0);
      ctx.restore();
    }
    ctx.strokeStyle = rgba(GOLD, 0.85);
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    const working = state !== "idle" && activeGlyph;
    for (let i = 0; i < 12; i++) {
      const a = spin * 0.6 + (i / 12) * Math.PI * 2 + dial.offset;
      const kind = GLYPHS[i % GLYPHS.length];
      const lit = working && kind === activeGlyph;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * gr, cy + Math.sin(a) * gr);
      ctx.rotate(a + Math.PI / 2);
      if (lit) {
        const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.sin((now - activeGlyphAt) / 160);
        ctx.strokeStyle = rgba([255, 236, 180], 0.95);
        ctx.shadowColor = rgba(COLOURS[state] ?? COLOURS.thinking, 0.95);
        ctx.shadowBlur = 6 + pulse * 8;
        ctx.lineWidth = 1.6;
        glyph(kind, 5.4);
      } else {
        glyph(kind, 4.2);
      }
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

    ctx.restore();

    ctx.save();
    if (listenGlow) {
      ctx.shadowColor = rgba(COLOURS.listening, 0.9);
      ctx.shadowBlur = 8 + listenGlow * 10;
    }
    ctx.globalAlpha = st.wings;
    ctx.translate(cx, cy);
    ctx.scale(0.4 + 0.6 * st.wings, 0.4 + 0.6 * st.wings);
    ctx.translate(-cx, -cy);
    lowerWings(cx, cy, gr + 7, t, state !== "idle", hovered, listenGlow);
    ctx.restore();

    // Volume arc, briefly, after a change: gold, clockwise from the top, around the outside of the ring.
    if (volumeLevel !== null && now - volumeShownAt < 1500) {
      const fade = 1 - (now - volumeShownAt) / 1500;
      ctx.beginPath();
      ctx.arc(cx, cy, gr + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * volumeLevel);
      ctx.strokeStyle = rgba(GOLD, 0.9 * fade);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.stroke();
    }

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
    horusEye(eye * st.eye);
    ctx.restore();

    requestAnimationFrame(draw);
  }

  // The window sizes itself to what's showing (the orb, plus any caption, approval or question card), so cards are
  // never cut off and no invisible window is left blocking clicks. The main process keeps the orb where it is.
  const main = document.querySelector("main");
  let lastFit = 0;
  const reportFit = () => {
    const style = getComputedStyle(main);
    const gap = parseFloat(style.rowGap) || 0;
    const shown = [...main.children].filter((el) => !el.hidden && el.getClientRects().length);
    const height =
      shown.reduce((sum, el) => sum + el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginTop || 0), 0) +
      gap * Math.max(0, shown.length - 1) +
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      8;
    const rounded = Math.ceil(height);
    if (Math.abs(rounded - lastFit) < 2) return;
    lastFit = rounded;
    bridge.send({ type: "fit", height: rounded });
  };
  new ResizeObserver(reportFit).observe(main);
  for (const el of main.children) new ResizeObserver(reportFit).observe(el);
  new MutationObserver(reportFit).observe(main, { subtree: true, attributes: true, attributeFilter: ["hidden"] });

  setState("idle");
  requestAnimationFrame(draw);
})();
