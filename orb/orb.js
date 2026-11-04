// Draws the orb and handles Astra's messages. States: idle, listening, thinking, speaking.
(() => {
  const canvas = document.getElementById("orb");
  let ctx = canvas.getContext("2d");
  // The ring glyph for whatever she's doing right now glows while she works.
  let activeGlyph = null;
  let activeGlyphAt = 0;
  const talk = document.getElementById("talk");
  const stopButton = document.getElementById("stop");
  const recordButton = document.getElementById("record");
  const frontButton = document.getElementById("front");
  const typeOnlyButton = document.getElementById("type-only");
  const typeBox = document.getElementById("type-box");
  const typeText = document.getElementById("type-text");
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
  /** God mode's Eye, satellites and slate (god.js); the ring is drawn here. */
  const god = window.astraGod;
  const eyeButton = document.getElementById("eye");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Arc reactor meets the winged sun: turquoise reactor light, lapis and gold.
  const W = 320;
  const H = 260;
  /**
   * Room round the drawing frame: everything is drawn in W × H as before, but the canvas is this much bigger, so her
   * glow, Anubis, Thoth and the transfer beams fade out softly instead of stopping at the frame's edges. With
   * click-through (hit.js) the extra room catches no clicks. Keep in step with #orb in orb.css.
   */
  const PAD = { x: 40, top: 56, bottom: 70 };
  /** The whole canvas, in drawing coordinates. */
  const FULL = [-PAD.x, -PAD.top, W + 2 * PAD.x, H + PAD.top + PAD.bottom];
  const R = 34;
  /** Out to just past her glyph ring (R × 1.72 + 7): all of it is grabbable, gaps included. */
  const BODY_RADIUS = Math.round(R * 1.72 + 14);
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
  /** The status text for a state: "Researching…" while Thoth is up and she's working. */
  const labelFor = (s) => (scribeState === "researching" && s === "thinking" ? "Researching…" : LABELS[s]);
  const TALK_LABELS = { listening: "Stop listening" };

  let state = "idle";
  let colour = [...COLOURS.idle];
  /** God mode: a ring of carved glyphs turning slowly round her (see drawGodRing), in every state. */
  let godMode = false;
  /** 0..1: the ring fades in and out with God mode, and her lower wings move out and back with it. */
  let godAmt = 0;
  /**
   * How far her lower wings (and the glyph buttons on them) move out in God mode, so the ring and the satellites'
   * orbit (god.css --sat-r: 106px) never cross them: their inner edge goes from just outside the ring to just outside
   * the orbit. Keep in step with orb.css (body.god-mode .orb-wrap) and god.js (ROOT_OFFSET).
   */
  const WINGS_OUT = 50;
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
  canvas.width = (W + 2 * PAD.x) * dpr;
  canvas.height = (H + PAD.top + PAD.bottom) * dpr;
  ctx.scale(dpr, dpr);
  ctx.translate(PAD.x, PAD.top);
  // Where the drawing frame starts inside the canvas: the sky part of a transfer (sky.js) carries on from there.
  canvas.dataset.frameTop = String(PAD.top);

  const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a))})`;
  const lerp = (a, b, t) => a + (b - a) * t;

  // ── Gate dial: on each state change the glyph ring dials like a stargate ──
  // The ring spins and settles on a symbol, the top chevron engages and the next mirror pair of chevrons lights (both
  // sides at once, top down: see dial.js); it reverses for the next symbol, one lock per pair, then the whole ring
  // flares and a burst ripples out from the eye. With reduced motion: no spin or burst, just a brief full-ring glow.
  const CHEVRONS = 9;
  const LOCKS = window.astraDial.locksFor(CHEVRONS);
  const SPIN_MS = 340;
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

  const fullSpin = () => Array.from({ length: LOCKS }, (_, k) => spinFor(k)).reduce((sum, s) => sum + s, 0);

  function startUnlock() {
    if (reducedMotion) {
      // No movement: the ring just glows once, gently.
      dialAt = performance.now() - DIAL_MS - BURST_MS;
      return;
    }
    if (dialing) ringOffset = dialFrom + fullSpin();
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
        ringOffset = dialFrom + fullSpin();
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
    stateLabel.textContent = labelFor(next);
    // Finished: the last step she worked on is done, not still "current" (it read "Thinking…" while she sat idle).
    if (next === "idle") {
      for (const li of activity.children) li.className = "done";
      // A bare "Thinking…" left over says nothing once she's finished, and reads as if she still is.
      if (activity.lastElementChild?.dataset.text === "Thinking…") activity.lastElementChild.remove();
    }
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
    cardToggle.setAttribute("aria-expanded", String(!collapsed));
    cardToggle.setAttribute("aria-label", collapsed ? "Expand the thinking window" : "Collapse the thinking window");
    cardToggle.title = collapsed ? "Expand" : "Collapse";
    cardToggle.textContent = collapsed ? "▸" : "▾";
    try {
      localStorage.setItem("astra.cardCollapsed", collapsed ? "1" : "0");
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  }
  cardToggle.addEventListener("click", () => (card.classList.contains("collapsed") ? showCard() : foldCard()));
  // The state label under the orb toggles the panel too: with it collapsed, it's the way back.
  // Shown on request (the dropdown or "expand your panel"), her thinking window stays up until you fold it; otherwise
  // it hides itself 12 s after she goes quiet. (It used to unfold while still hidden, so nothing appeared.)
  let cardPinned = false;
  function showCard() {
    cardPinned = true;
    clearTimeout(captionTimer);
    card.hidden = false;
    setCollapsed(false);
  }
  function foldCard() {
    cardPinned = false;
    setCollapsed(true);
  }

  // ── The status indicator's dropdown: her thinking window, and any panel that's closed or folded ──
  const panelMenu = document.getElementById("panel-menu");
  // The nub tab's outline, as on the cards (frame.css styles it).
  const NUB_SVG =
    '<svg viewBox="0 0 170 22" preserveAspectRatio="none"><polygon class="plate" points="0,22 170,22 170,10 156,0 0,0"/>' +
    '<polyline class="edge" points="0,0.8 156,0.8 169.5,10.5"/><polyline class="edge-inner" points="0,4 154,4 165,12"/></svg>';
  let panels = []; // [{ kind, state }] from the main process
  const menuOpen = () => !panelMenu.hidden;
  function closeMenu(refocus = false) {
    if (!menuOpen()) return;
    panelMenu.hidden = true;
    stateLabel.setAttribute("aria-expanded", "false");
    if (refocus) stateLabel.focus();
  }
  function openMenu() {
    const cardShown = !card.hidden && !card.classList.contains("collapsed");
    const items = window.astraPanelMenu.menuItems({ cardShown, panels });
    // A small god slate, like the thinking window: a nub tab, a glow shelf, then one row per item. A panel's row
    // reads as its name with what choosing it does above ("Reopen", "Unfold", "Bring forward").
    const tab = document.createElement("div");
    tab.className = "nub";
    tab.setAttribute("aria-hidden", "true");
    tab.innerHTML = NUB_SVG + '<p class="nub-label">Panels</p>';
    const shelf = document.createElement("div");
    shelf.className = "shelf";
    shelf.setAttribute("aria-hidden", "true");
    panelMenu.replaceChildren(
      tab,
      shelf,
      ...items.map((item) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.tabIndex = -1;
        b.dataset.id = item.id;
        const [verb, name] = item.label.includes(": ") ? item.label.split(": ") : [null, item.label];
        if (verb) b.dataset.verb = verb.toLowerCase().replace(/\s+/g, "-");
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.className = "text";
        if (verb) {
          const small = document.createElement("span");
          small.className = "verb";
          small.textContent = verb;
          text.append(small);
        }
        const big = document.createElement("span");
        big.className = "name";
        big.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        text.append(big);
        b.append(mark, text);
        // Read as one phrase ("Reopen: map"), not two.
        b.setAttribute("aria-label", item.label);
        return b;
      }),
    );
    panelMenu.hidden = false;
    stateLabel.setAttribute("aria-expanded", "true");
    panelMenu.querySelector("button")?.focus();
  }
  function choose(id) {
    closeMenu(true);
    if (id === "card") return card.hidden || card.classList.contains("collapsed") ? showCard() : foldCard();
    if (id === "front") return bridge.send({ type: "panels-front" });
    bridge.send({ type: "panel-restore", kind: id });
  }
  stateLabel.addEventListener("click", () => (menuOpen() ? closeMenu() : openMenu()));
  stateLabel.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openMenu();
    } else if (e.key === "Escape" && menuOpen()) {
      // Only closes the menu: Esc elsewhere on the orb stops her.
      e.stopPropagation();
      closeMenu(true);
    }
  });
  panelMenu.addEventListener("click", (e) => {
    const id = e.target.closest("button")?.dataset.id;
    if (id) choose(id);
  });
  panelMenu.addEventListener("keydown", (e) => {
    const items = [...panelMenu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    const go = (n) => items[(n + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") closeMenu(true);
    else if (e.key === "Tab") closeMenu();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  // A click anywhere else, or switching away from the orb, closes it.
  document.addEventListener("pointerdown", (e) => {
    if (menuOpen() && !panelMenu.contains(e.target) && e.target !== stateLabel) closeMenu();
  });
  window.addEventListener("blur", () => closeMenu());
  try {
    setCollapsed(localStorage.getItem("astra.cardCollapsed") === "1");
  } catch {
    setCollapsed(false);
  }

  // Type-only mode: the card is the conversation, so replies pile up as a log and stay until you close it.
  let typeOnlyMode = false;
  const LOG_MAX = 40;

  function resetActivity() {
    activity.replaceChildren();
    if (typeOnlyMode) return;
    caption.textContent = "";
    captionSpoken.textContent = "";
  }

  function keepCard() {
    clearTimeout(captionTimer);
    if (typeOnlyMode || cardPinned) return;
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
    clearTimeout(captionTimer);
    if (typeOnlyMode) {
      cancelAnimationFrame(typing);
      if (!caption.querySelector(".line")) caption.textContent = "";
      const line = document.createElement("p");
      line.className = `line ${role}`;
      line.textContent = text;
      caption.append(line);
      while (caption.children.length > LOG_MAX) caption.firstElementChild.remove();
      caption.scrollTop = caption.scrollHeight;
      return;
    }
    typeOut(caption, text);
    if (cardPinned) return;
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
    else if (m.type === "guard") guardState = m.state === "checking" || m.state === "blocked" || m.state === "voice" ? m.state : null;
    else if (m.type === "scribe") {
      const next = m.state === "researching" || m.state === "found" ? m.state : null;
      if (next === "found" && scribeState !== "found") glintAt = performance.now();
      if (next !== "found") glintAt = 0;
      scribeState = next;
      // The status says "Researching" while he's up: the glyph is never the only signal.
      stateLabel.textContent = labelFor(state);
    }
    else if (m.type === "coffee") showCoffee(m);
    else if (m.type === "mode") {
      const on = !!m.typeOnly;
      if (on !== typeOnlyMode) caption.textContent = "";
      typeOnlyMode = on;
      document.body.classList.toggle("type-only", on);
      typeOnlyButton.setAttribute("aria-pressed", String(on));
      typeBox.hidden = !on;
      if (on) typeText.focus();
      typeOnlyButton.setAttribute("aria-label", on ? "Back to voice: microphone and speech on" : "Type only: microphone off and silent");
      document.body.classList.toggle("god-mode", !!m.god);
      godMode = !!m.god;
      god.setMode(godMode);
      // The status says what she's doing; God mode shows in her ring, satellites and Eye, so idle reads as idle.
      LABELS.idle = on ? "Type only" : "Idle";
      if (state === "idle") stateLabel.textContent = LABELS.idle;
    } else if (m.type === "recording") {
      recording = !!m.on;
      recordButton.setAttribute("aria-pressed", String(recording));
      recordButton.setAttribute("aria-label", recording ? "Stop the transcript" : "Start a transcript");
    }
    else if (m.type === "layout") {
      document.body.classList.toggle("top", !!m.top);
      document.body.classList.toggle("split", !!m.split);
    }
    else if (m.type === "collapse") (m.collapsed ? foldCard() : showCard());
    else if (m.type === "god-sessions") god.setEntries(m.sessions);
    else if (m.type === "panels") panels = Array.isArray(m.panels) ? m.panels : [];
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
      // The slate's room goes first, so the drag starts from the window's own size.
      god.foldNow();
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
  frontButton.addEventListener("click", () => bridge.send({ type: "panels-front" }));
  recordButton.addEventListener("click", () => bridge.send({ type: "record" }));
  typeOnlyButton.addEventListener("click", () => bridge.send({ type: "type-only", on: typeOnlyButton.getAttribute("aria-pressed") !== "true" }));
  // The glyphs on the lower wings glow under the pointer (the glow is drawn on the canvas, under the buttons).
  let hovered = null;
  let recording = false;
  for (const [el, id] of [[stopButton, "stop"], [document.getElementById("minimise"), "minimise"], [recordButton, "record"], [typeOnlyButton, "type-only"], [frontButton, "front"], [eyeButton, "eye"]]) {
    el.addEventListener("pointerenter", () => (hovered = id));
    el.addEventListener("pointerleave", () => (hovered = null));
    el.addEventListener("focus", () => (hovered = id));
    el.addEventListener("blur", () => (hovered = null));
  }

  // Each wing button's help text (wing-tips.js), on hover and keyboard focus.
  const wingTips = window.astraWingTips.create(document, [stopButton, recordButton, typeOnlyButton, document.getElementById("minimise"), frontButton, eyeButton]);

  // Clicks pass through the window's empty space to the app underneath (see hit.js), so her click area is the shape of
  // her body. The window stops ignoring the pointer whenever it's over something drawn; never mid-drag, or the drag
  // would lose its mouse-up.
  let clickThrough = false;
  const setClickThrough = (on) => {
    if (on === clickThrough) return;
    clickThrough = on;
    bridge.send({ type: "click-through", on });
  };
  window.addEventListener("mousemove", (e) => {
    if (e.buttons) {
      wingTips.pointer(null);
      return setClickThrough(false);
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    wingTips.pointer(el, e.clientX, e.clientY);
    let target = "empty";
    let alpha = 0;
    if (el === canvas || el === talk) {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      target = "canvas";
      // The core (the talk button) is always clickable; elsewhere it's whether a pixel of her is drawn there.
      const core = talk.getBoundingClientRect();
      const fromCore = Math.hypot(e.clientX - (core.left + core.width / 2), e.clientY - (core.top + core.height / 2));
      // Her ring and core, gaps included, are her body; past them, whether a pixel of her (wings, a figure) is drawn.
      alpha = fromCore <= BODY_RADIUS ? 255 : ctx.getImageData(Math.floor((e.clientX - r.left) * dpr), Math.floor((e.clientY - r.top) * dpr), 1, 1).data[3];
      // In God mode, pointing at her body pops the slate out.
      god.pointer(fromCore <= BODY_RADIUS);
    } else if (el && el !== document.body && el !== document.documentElement && !el.matches("main, .orb-wrap, .state-wrap")) target = "control";
    if (target !== "canvas") god.pointer(false);
    // A wing button's help text, while it shows, is part of her too (it lets clicks through to what it covers).
    setClickThrough(!(wingTips.covers(e.clientX, e.clientY) || window.astraHit.isSolid({ target, alpha })));
  });
  document.addEventListener("mouseleave", () => {
    god.pointer(false);
    wingTips.pointer(null);
    setClickThrough(true);
  });

  typeBox.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = typeText.value.trim();
    if (!text) return;
    bridge.send({ type: "typed", text });
    typeText.value = "";
  });

  window.addEventListener("keydown", (e) => {
    // Escape on the slate (or on her, with it out) folds it and stays there; anywhere else it folds it and stops her.
    if (e.key === "Escape" && god.escape()) return e.preventDefault();
    // Escape on a wing button showing its help text hides the text; the next Escape stops her.
    if (e.key === "Escape" && wingTips.escape(e.target)) return e.preventDefault();
    // Typing to her: letters and digits are text, not answer shortcuts; Esc still stops her.
    if (e.target === typeText) {
      if (e.key === "Escape") bridge.send({ type: "stop" });
      return;
    }
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

  /** Coffee mode's water clock under her status: a slow silent drip while the Mac is kept awake. */
  const coffee = document.getElementById("coffee");
  function showCoffee(m) {
    coffee.hidden = !m.on;
    if (!m.on) return void coffee.replaceChildren();
    if (!coffee.firstChild) coffee.innerHTML = window.astraGlyphs.svg("clepsydra", "is-live");
    const until = typeof m.until === "number" ? new Date(m.until).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" }) : null;
    const label = until ? `Coffee mode on until ${until}: the Mac stays awake` : "Coffee mode on: the Mac stays awake";
    coffee.setAttribute("aria-label", label);
    coffee.title = label;
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

  // God mode's ring: the slate's own glyphs (god-glyphs.js), carved twice round a thin gold band just outside the
  // chevrons, turning once every 90 s (still with reduced motion). Her lower wings move out past it (WINGS_OUT), so
  // every glyph shows all the way round.
  const GOD_PATHS = new Map(Object.entries(window.astraGodGlyphs.GLYPHS).map(([name, g]) => [name, g.strokes.map((d) => new Path2D(d))]));
  const GOD_RING = [...window.astraGodGlyphs.RING_GLYPHS, ...window.astraGodGlyphs.RING_GLYPHS];
  function drawGodRing(cx, cy, gr, t, amt) {
    const inner = gr + 19;
    const outer = gr + 33;
    const mid = (inner + outer) / 2;
    ctx.save();
    ctx.strokeStyle = rgba(GOLD, 0.75 * amt);
    ctx.lineWidth = 1;
    for (const rr of [inner, outer]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    const turn = reducedMotion ? 0 : (t * Math.PI * 2) / 90;
    const size = 10;
    for (let i = 0; i < GOD_RING.length; i++) {
      const a = -Math.PI / 2 + turn + (i / GOD_RING.length) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * mid, cy + Math.sin(a) * mid);
      ctx.rotate(a + Math.PI / 2);
      ctx.scale(size / 48, size / 48);
      ctx.translate(-24, -24);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 4.4;
      // Carved: a dark cut up and to the left of the gold leaf.
      ctx.shadowColor = rgba([0, 0, 0], 0.9 * amt);
      ctx.shadowOffsetX = -1;
      ctx.shadowOffsetY = -1;
      ctx.strokeStyle = rgba([240, 200, 104], 0.95 * amt);
      for (const path of GOD_PATHS.get(GOD_RING[i])) ctx.stroke(path);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Lower wings that wrap the bottom of the glyph ring: three tiers of gold feathers laid along arcs concentric with the
   * ring, so they meet it cleanly and sweep up towards their tips. Stop (left) and minimise (right) sit on them; the
   * DOM buttons are positioned over GLYPH_ANGLE, and this draws the glow behind each glyph. `out` moves the whole
   * wing that much further from her centre (God mode, WINGS_OUT); the feathers keep their size.
   */
  const GLYPH_ANGLE = 0.24;
  // Record and type-only, further out along the wings.
  const OUTER_ANGLE = 0.55;
  // The sun (right) and God mode's Eye (left), further out still (orb.css #front, god.css #eye).
  const SUN_ANGLE = 0.88;
  function lowerWings(cx, cy, ringR, t, busy, hover, glow = 0, out = 0) {
    const base = ringR + 9 + out; // just outside the ring's outer line, or the satellites' orbit in God mode
    const tiers = [
      { h: 7, end: 1.08, alpha: 0.95 },
      { h: 8, end: 0.9, alpha: 0.8 },
      { h: 10, end: 0.7, alpha: 0.65 },
    ];
    const step = (0.055 * (ringR + 9)) / base;
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
    for (const { el, side, angle } of WING_BUTTONS) {
      const id = el.id;
      const busyStop = (id === "stop" && busy) || (id === "record" && recording);
      const lit = (hover === id ? 1 : 0) + (busyStop ? 0.55 + 0.3 * Math.sin(t * 4) : 0);
      if (lit <= 0) continue;
      const x = cx + side * Math.sin(angle) * glyphR;
      const y = cy + Math.cos(angle) * glyphR;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 15);
      glow.addColorStop(0, rgba(busyStop ? [255, 110, 90] : GOLD, 0.5 * Math.min(1, lit)));
      glow.addColorStop(1, rgba(busyStop ? [255, 110, 90] : GOLD, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(x - 15, y - 15, 30, 30);
    }
  }

  /** The glyph buttons on her lower wings, by id: which side (-1 left) and how far round from straight down. */
  const WING_BUTTONS = [["stop", -1, GLYPH_ANGLE], ["minimise", 1, GLYPH_ANGLE], ["record", -1, OUTER_ANGLE], ["type-only", 1, OUTER_ANGLE], ["front", 1, SUN_ANGLE], ["eye", -1, SUN_ANGLE]].map(
    ([id, side, angle]) => ({ el: document.getElementById(id), side, angle }),
  );
  let placedOut = 0;
  /** Moves the wing buttons out with the drawn wings (orb.css holds their normal places). */
  function placeWingButtons(out) {
    const rounded = Math.round(out * 4) / 4;
    if (rounded === placedOut) return;
    placedOut = rounded;
    for (const { el, side, angle } of WING_BUTTONS) {
      el.style.translate = rounded ? `${(side * Math.sin(angle) * rounded).toFixed(2)}px ${(Math.cos(angle) * rounded).toFixed(2)}px` : "";
    }
    wingTips.place();
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

  // Gold sand: while she thinks, tiny gold grains trickle off the ring and wings like an hourglass.
  const sand = [];
  const SAND_MAX = reducedMotion ? 20 : 140;
  function drawSand(cx, cy, ringR, thinking, fade) {
    const rate = thinking ? (reducedMotion ? 0.3 : 3) : 0;
    for (let n = rate; n > 0 && sand.length < SAND_MAX; n--) {
      if (n < 1 && Math.random() > n) break;
      // From the lower half of the ring and along the wings, heavier near the middle.
      const a = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (0.6 + Math.random() * 0.8);
      const spread = 0.6 + Math.random() * 0.5;
      sand.push({
        x: cx + Math.cos(a) * ringR * spread * 1.6,
        y: cy + Math.abs(Math.sin(a)) * ringR * spread * 0.9,
        vx: (Math.random() - 0.5) * 0.15,
        vy: 0.25 + Math.random() * 0.5,
        size: Math.random() < 0.7 ? 1.4 : 2,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
    for (let i = sand.length - 1; i >= 0; i--) {
      const g = sand[i];
      g.vy += 0.025;
      g.x += g.vx;
      g.y += g.vy;
      const life = 1 - (g.y - cy) / (H - cy);
      if (life <= 0) {
        sand.splice(i, 1);
        continue;
      }
      const shimmer = 0.65 + 0.35 * Math.sin(g.twinkle + g.y * 0.25);
      ctx.fillStyle = rgba(GOLD, Math.min(1, life * 1.4) * shimmer * fade);
      ctx.fillRect(Math.round(g.x), Math.round(g.y), g.size, g.size);
    }
  }

  // Uploads and downloads are drawn whole on the beam layer (orb/sky.js), from her core to the top of the screen.

  // Security checks: Anubis rises behind the orb, head and shoulders, holding the was sceptre. His eyes glow gold while
  // he checks and burn red when he blocks a site.
  let guardState = null;
  let guardAmt = 0;
  let guardRed = 0;
  const JACKAL = [16, 20, 34];

  // ── Thoth, the scribe: rises behind the orb while she researches (see src/scribe.ts) ──
  let scribeState = null;
  let thothAmt = 0;
  /** How bright his moon is: it builds slowly while he researches, and resets once he has gone. */
  let moonAmt = 0;
  /** When the research was found (his one glint), or 0. */
  let glintAt = 0;
  const MOON = [226, 232, 255];

  /**
   * Thoth, head and shoulders, the way Anubis stands: an ibis head with a long curved beak under a crescent and moon
   * disc, a reed pen in his right hand writing marks that drift up and fade like ink turning to light, and a scribe's
   * palette resting at his left shoulder. Gold line work on lapis and the dark, as Anubis is drawn.
   */
  function drawScribe(cx, t, amt, moon, glint) {
    const rise = (1 - amt) * 34;
    const bob = reducedMotion ? 0 : Math.sin(t * 1.3 + 1) * 1.1;
    const y0 = 3 + rise + bob; // top of the moon disc
    ctx.save();
    ctx.globalAlpha = amt;

    // A soft moonlit ward over the orb.
    const ward = ctx.createRadialGradient(cx, y0 + 36, 4, cx, y0 + 36, 92);
    ward.addColorStop(0, rgba(MOON, 0.1 + 0.1 * moon));
    ward.addColorStop(1, rgba(MOON, 0));
    ctx.fillStyle = ward;
    ctx.fillRect(...FULL);

    // Shoulders, lapis into the dark, gold along the top.
    ctx.beginPath();
    ctx.moveTo(cx - 62, y0 + 84);
    ctx.quadraticCurveTo(cx - 58, y0 + 55, cx - 24, y0 + 49);
    ctx.lineTo(cx + 24, y0 + 49);
    ctx.quadraticCurveTo(cx + 58, y0 + 55, cx + 62, y0 + 84);
    const body = ctx.createLinearGradient(0, y0 + 49, 0, y0 + 84);
    body.addColorStop(0, rgba(LAPIS, 0.95));
    body.addColorStop(0.6, rgba(JACKAL, 0.8));
    body.addColorStop(1, rgba(JACKAL, 0));
    ctx.fillStyle = body;
    ctx.fill();
    const edge = ctx.createLinearGradient(0, y0 + 49, 0, y0 + 84);
    edge.addColorStop(0, rgba(GOLD, 0.9));
    edge.addColorStop(1, rgba(GOLD, 0));
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Striped headdress falling either side of his neck.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + side * (8 + i * 2), y0 + 30 + i * 6);
        ctx.lineTo(cx + side * (16 + i * 2.4), y0 + 30 + i * 6);
        ctx.lineTo(cx + side * (18 + i * 2.4), y0 + 36 + i * 6);
        ctx.lineTo(cx + side * (10 + i * 2), y0 + 36 + i * 6);
        ctx.closePath();
        ctx.fillStyle = rgba(i % 2 ? LAPIS : GOLD, 0.95);
        ctx.fill();
      }
    }

    // Collar: gold, turquoise, gold.
    [[20, GOLD], [24.5, [70, 210, 220]], [29, GOLD]].forEach(([radius, colour]) => {
      ctx.beginPath();
      ctx.arc(cx, y0 + 42, radius, Math.PI * 0.16, Math.PI * 0.84);
      ctx.strokeStyle = rgba(colour, 0.9);
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    // Crescent and moon disc above his head, brightening as he works.
    const mx = cx;
    const my = y0 + 9;
    const halo = ctx.createRadialGradient(mx, my, 2, mx, my, 20);
    halo.addColorStop(0, rgba(MOON, 0.35 + 0.45 * moon));
    halo.addColorStop(1, rgba(MOON, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(mx - 20, my - 20, 40, 40);
    ctx.beginPath();
    ctx.arc(mx, my, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba([lerp(150, 245, moon), lerp(160, 248, moon), lerp(200, 255, moon)], 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my + 2, 9.5, Math.PI * 0.1, Math.PI * 0.9);
    ctx.strokeStyle = rgba(GOLD, 0.95);
    ctx.lineWidth = 2;
    ctx.stroke();

    // The ibis head: a rounded crown, and the long beak curving down and away to his right.
    ctx.fillStyle = rgba(JACKAL, 1);
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx + 1, y0 + 27, 8.5, 7.5, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 5, y0 + 24);
    ctx.bezierCurveTo(cx - 16, y0 + 27, cx - 24, y0 + 36, cx - 27, y0 + 50);
    ctx.bezierCurveTo(cx - 21, y0 + 39, cx - 14, y0 + 32, cx - 4, y0 + 30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // His eye: a bright, calm point.
    const glow = 0.75 + (reducedMotion ? 0 : 0.25 * Math.sin(t * 2.2));
    ctx.beginPath();
    ctx.arc(cx - 1, y0 + 25.5, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = rgba([255, 226, 150], glow);
    ctx.shadowColor = rgba([255, 214, 110], 0.9);
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // The palette at his left shoulder: a slim board with two ink wells.
    ctx.save();
    ctx.translate(cx - 50, y0 + 58);
    ctx.rotate(-0.55);
    ctx.beginPath();
    ctx.roundRect(-4, -15, 8, 30, 2);
    ctx.fillStyle = rgba(JACKAL, 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    for (const wy of [-10, -4]) {
      ctx.beginPath();
      ctx.arc(0, wy, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = rgba(wy < -6 ? [200, 70, 60] : GOLD, 0.9);
      ctx.fill();
    }
    ctx.restore();

    // The reed pen in his right hand, and his arm reaching up from the shoulder.
    const nx = cx + 66;
    const ny = y0 + 30;
    ctx.beginPath();
    ctx.moveTo(cx + 46, y0 + 64);
    ctx.quadraticCurveTo(cx + 60, y0 + 62, cx + 60, y0 + 50);
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.strokeStyle = rgba(LAPIS, 1);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 58, y0 + 56);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = rgba(GOLD, 0.95);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = rgba(GOLD, 0.95);
    ctx.fillRect(cx + 56.5, y0 + 49, 6, 4);

    // Writing: small gold marks leave the nib, drift up and fade, like ink becoming light. Not with reduced motion.
    if (!reducedMotion && scribeState === "researching") {
      for (let i = 0; i < 6; i++) {
        const p = (t * 0.55 + i / 6) % 1;
        const x = nx + Math.sin(i * 1.9 + p * 4) * 5 + p * 4;
        const y = ny - 2 - p * 34;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(i * 0.9 + p);
        ctx.strokeStyle = rgba([255, 226, 150], (1 - p) * 0.85);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-2, 0);
        ctx.lineTo(2, i % 2 ? 1.5 : -1.5);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Found: one soft glint off the moon before he sinks away.
    if (glint > 0) {
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 26 * glint + 6);
      g.addColorStop(0, rgba([255, 255, 255], 0.9 * glint));
      g.addColorStop(1, rgba(MOON, 0));
      ctx.fillStyle = g;
      ctx.fillRect(mx - 34, my - 34, 68, 68);
      ctx.strokeStyle = rgba([255, 250, 230], 0.8 * glint);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx - 14 * glint, my);
      ctx.lineTo(mx + 14 * glint, my);
      ctx.moveTo(mx, my - 14 * glint);
      ctx.lineTo(mx, my + 14 * glint);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGuardian(cx, t, amt, red) {
    const rise = (1 - amt) * 34;
    const bob = reducedMotion ? 0 : Math.sin(t * 1.6) * 1.2;
    const y0 = 3 + rise + bob; // top of his ears
    const eyeColour = [lerp(255, 255, red), lerp(214, 70, red), lerp(110, 60, red)];
    ctx.save();
    ctx.globalAlpha = amt;

    // A faint ward over the orb: the arc he keeps.
    const ward = ctx.createRadialGradient(cx, y0 + 30, 4, cx, y0 + 30, 90);
    ward.addColorStop(0, rgba(red > 0.5 ? [255, 90, 70] : GOLD, 0.18));
    ward.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = ward;
    ctx.fillRect(...FULL);

    // Shoulders, lapis fading into the dark behind the orb, the top edge in gold.
    ctx.beginPath();
    ctx.moveTo(cx - 64, y0 + 80);
    ctx.quadraticCurveTo(cx - 60, y0 + 50, cx - 26, y0 + 44);
    ctx.lineTo(cx + 26, y0 + 44);
    ctx.quadraticCurveTo(cx + 60, y0 + 50, cx + 64, y0 + 80);
    const body = ctx.createLinearGradient(0, y0 + 44, 0, y0 + 80);
    body.addColorStop(0, rgba(LAPIS, 0.95));
    body.addColorStop(0.6, rgba(JACKAL, 0.8));
    body.addColorStop(1, rgba(JACKAL, 0));
    ctx.fillStyle = body;
    ctx.fill();
    const edge = ctx.createLinearGradient(0, y0 + 44, 0, y0 + 80);
    edge.addColorStop(0, rgba(GOLD, 0.9));
    edge.addColorStop(1, rgba(GOLD, 0));
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Striped headdress falling behind his head to the shoulders.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + side * (10 + i * 2.2), y0 + 18 + i * 6.5);
        ctx.lineTo(cx + side * (19 + i * 2.6), y0 + 18 + i * 6.5);
        ctx.lineTo(cx + side * (21 + i * 2.6), y0 + 24 + i * 6.5);
        ctx.lineTo(cx + side * (12 + i * 2.2), y0 + 24 + i * 6.5);
        ctx.closePath();
        ctx.fillStyle = rgba(i % 2 ? LAPIS : GOLD, 0.95);
        ctx.fill();
      }
    }

    // Broad collar (wesekh): rows of gold and turquoise.
    [[22, GOLD], [26.5, [70, 210, 220]], [31, GOLD]].forEach(([radius, colour]) => {
      ctx.beginPath();
      ctx.arc(cx, y0 + 36, radius, Math.PI * 0.16, Math.PI * 0.84);
      ctx.strokeStyle = rgba(colour, 0.9);
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    // The jackal head, facing you: tall ears, narrow muzzle.
    ctx.fillStyle = rgba(JACKAL, 1);
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * 4, y0 + 13);
      ctx.lineTo(cx + side * 13, y0);
      ctx.lineTo(cx + side * 13, y0 + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + side * 7, y0 + 12);
      ctx.lineTo(cx + side * 11.5, y0 + 5);
      ctx.lineTo(cx + side * 11.5, y0 + 13);
      ctx.closePath();
      ctx.fillStyle = rgba(GOLD, 0.75);
      ctx.fill();
      ctx.fillStyle = rgba(JACKAL, 1);
    }
    ctx.beginPath();
    ctx.ellipse(cx, y0 + 19, 11, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 7, y0 + 22);
    ctx.lineTo(cx + 7, y0 + 22);
    ctx.lineTo(cx + 2.5, y0 + 37);
    ctx.lineTo(cx - 2.5, y0 + 37);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, y0 + 36.5, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = rgba(GOLD, 0.9);
    ctx.fill();

    // Eyes: watchful slits that pulse while he checks.
    const glow = 0.7 + (reducedMotion ? 0 : 0.3 * Math.sin(t * 4));
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * 5, y0 + 18, 2.6, 1.1, side * -0.25, 0, Math.PI * 2);
      ctx.fillStyle = rgba(eyeColour, glow);
      ctx.shadowColor = rgba(eyeColour, 0.9);
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // The was sceptre in his hand, beside the orb: a forked staff with an angled animal head, a light scanning up it.
    const sx = cx + 70;
    const top = y0 + 4;
    const bottom = y0 + 92;
    ctx.strokeStyle = rgba(GOLD, 0.95);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, bottom);
    ctx.lineTo(sx, top);
    ctx.lineTo(sx - 7, top - 3);
    ctx.moveTo(sx, top);
    ctx.lineTo(sx + 3, top - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 3, bottom + 4);
    ctx.lineTo(sx, bottom);
    ctx.lineTo(sx + 3, bottom + 4);
    ctx.stroke();
    // His hand: a gold band where he grips it, and his arm reaching from the shoulder.
    ctx.beginPath();
    ctx.moveTo(cx + 50, y0 + 60);
    ctx.quadraticCurveTo(sx - 4, y0 + 60, sx, y0 + 52);
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = rgba(LAPIS, 1);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = rgba(GOLD, 0.95);
    ctx.fillRect(sx - 3.5, y0 + 48, 7, 5);
    const p = reducedMotion ? 0.5 : (t * 0.9) % 1;
    const gy = bottom - (bottom - top) * p;
    const glint = ctx.createRadialGradient(sx, gy, 0, sx, gy, 6);
    glint.addColorStop(0, rgba(red > 0.5 ? [255, 120, 100] : [255, 248, 220], 0.95));
    glint.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = glint;
    ctx.fillRect(sx - 6, gy - 6, 12, 12);
    ctx.restore();
  }

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
      for (const el of [stopButton, document.getElementById("minimise"), recordButton, typeOnlyButton, frontButton, eyeButton, stateLabel]) el.style.opacity = String(controlsOpacity);
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

    ctx.clearRect(...FULL);

    // Halo: reactor light with a warm gold rim
    const halo = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 3.2);
    halo.addColorStop(0, rgba(colour, 0.4 + level * 0.35));
    halo.addColorStop(0.35, rgba(colour, 0.12 + level * 0.12));
    halo.addColorStop(0.6, rgba(GOLD, 0.05 + level * 0.06));
    halo.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(...FULL);

    // Anubis guards; Thoth researches; Anubis wins while he's up (orb/figures.js).
    const figures = window.astraFigures.figureTargets({ guard: guardState, scribe: scribeState, open: formTo === 1 });
    guardAmt = lerp(guardAmt, figures.anubis, 0.07);
    thothAmt = lerp(thothAmt, figures.thoth, 0.06);
    if (scribeState === "researching") moonAmt = Math.min(1, moonAmt + (reducedMotion ? 1 : 0.004));
    else if (thothAmt < 0.01) moonAmt = 0;
    const glint = glintAt && !reducedMotion ? Math.max(0, 1 - (performance.now() - glintAt) / 900) : 0;
    if (thothAmt > 0.01) drawScribe(cx, t, thothAmt * st.wings, moonAmt, glint);
    // Red eyes when he's stopped something: a blocked page, or a voice that isn't Dan's.
    guardRed = lerp(guardRed, guardState === "blocked" || guardState === "voice" ? 1 : 0, 0.12);
    if (guardAmt > 0.01) drawGuardian(cx, t, guardAmt * st.wings, guardRed);

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

    // God mode's ring goes under all her wings: the side wings cross it, and the lower ones wrap its lower half.
    godAmt = lerp(godAmt, godMode ? 1 : 0, reducedMotion ? 1 : 0.06);
    if (godAmt > 0.01) drawGodRing(cx, cy, r * 1.72, t, godAmt * Math.min(st.wings, st.rings));

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
      // Every chevron gets its turn: mirror pairs from the top down, then the whole ring (dial.js).
      const dialLit = Math.max(c === 0 ? dial.engage : 0, window.astraDial.chevronLit(c, dial.lit, CHEVRONS) ? dial.glow : 0);
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
    lowerWings(cx, cy, gr + 7, t, state !== "idle", hovered, listenGlow, WINGS_OUT * godAmt);
    placeWingButtons(WINGS_OUT * godAmt);
    ctx.restore();

    drawSand(cx, cy, gr, state === "thinking" && formTo === 1, st.wings);

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
  let lastDecision = 0;
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
    // The decision cards (an approval or a question), measured on their own: when there isn't room for them and the
    // transmission window below the orb, they open above it instead (see arrange in main.cjs).
    const decision = Math.ceil(
      shown.filter((el) => el.id === "ask" || el.id === "question").reduce((sum, el) => sum + el.getBoundingClientRect().height + gap, 0),
    );
    if (Math.abs(rounded - lastFit) < 2 && decision === lastDecision) return;
    lastFit = rounded;
    lastDecision = decision;
    bridge.send({ type: "fit", height: rounded, decision });
  };
  new ResizeObserver(reportFit).observe(main);
  for (const el of main.children) new ResizeObserver(reportFit).observe(el);
  new MutationObserver(reportFit).observe(main, { subtree: true, attributes: true, attributeFilter: ["hidden"] });

  setState("idle");
  requestAnimationFrame(draw);
})();
