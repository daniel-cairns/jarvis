// God mode on the orb: the Eye on her left wing, one satellite per commanded session, the toast, and the
// glyph slate that pops out beside her. (The rotating ring of glyphs is drawn on her canvas in orb.js.) Entries come
// from Astra as { type: "god-sessions" } (src/ui/godSlate.ts); opening one sends the sessions panel's own
// "session-action" message, which Astra checks again before acting.
(() => {
  const { GLYPHS, slateSide, needsDan, notableChanges, slateWing, glyphSvg } = window.astraGodGlyphs;
  const bridge = window.jarvis ?? { onMessage() {}, send() {} };

  const talk = document.getElementById("talk");
  const eye = document.getElementById("eye");
  const satellites = document.getElementById("satellites");
  const slate = document.getElementById("slate");
  const slateArt = document.getElementById("slate-art");
  const slateCells = document.getElementById("slate-cells");
  const toast = document.getElementById("god-toast");
  const news = document.getElementById("god-news");

  /** The orb's centre inside .orb-wrap (orb.js: W / 2, H / 2 + 6). */
  const CENTRE = { x: 160, y: 136 };
  /** The orb window's own width (main.cjs ORB_WIDTH, orb.css main): the slate's room is added to it. */
  const BASE_WIDTH = 430;
  /** How far from her centre the slate's root sits: just past the tips of her lower wings, moved out in God mode (orb.js WINGS_OUT). */
  const ROOT_OFFSET = 134;
  const SLATE_TOP = CENTRE.y + 8;
  const CELL = 40;
  const ROOT_PAD = 18;
  const SLATE_HEIGHT = 112;
  const WING = { rootY: 54, lift: 22, rootHalf: 23, tipHalf: 18 };
  /** Help text is 240 px wide, centred on its cartouche: how far it can reach past the slate's outer end. */
  const TIP_REACH = 120 - (8 + CELL / 2);
  /** Help text sits this far off its cartouche (god.css .slate-tip), and this far inside the window's edges. */
  const TIP_GAP = 6;
  const TIP_MARGIN = 4;
  /** How far an arrow key scrolls a long help text. */
  const TIP_LINE = 36;

  const IDLE_MS = 6000; // untouched this long, the slate folds away
  const GRACE_MS = 450; // lets the pointer or focus cross between the orb and the slate
  const FOLD_MS = 360; // the fold animation (orb.css .slate-wing)
  const TOAST_MS = 3200;

  let godOn = false;
  let modeSeen = false;
  let entries = [];
  /** key → glyph at the last update; null until the first update after God mode turns on (never news). */
  let previous = null;
  let open = false;
  let side = "left";
  let generation = 0;
  const holds = new Set();
  let idleTimer = 0;
  let graceTimer = 0;
  let toastTimer = 0;
  let quietFocus = false;
  /** A fold still animating: it gives the window its room back when it ends. */
  let pendingFold = null;
  let foldTimer = 0;

  /** A one-line toast across the top of her frame, announced politely. */
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      toast.textContent = "";
    }, TOAST_MS);
  }

  const time = (ms) => (ms ? new Date(ms).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit", hour12: false }) : "Unknown");
  const commanded = () => entries.filter((e) => e.satellite);
  const onSlate = () => entries.filter((e) => e.onSlate);

  /** "Commanding 4 sessions: 2 working, 1 idle, 1 waiting on you." */
  function summary() {
    const sats = commanded();
    const count = (state) => sats.filter((s) => s.satellite === state).length;
    if (!sats.length) return "No sessions to command right now.";
    const noun = sats.length === 1 ? "session" : "sessions";
    return `Commanding ${sats.length} ${noun}: ${count("working")} working, ${count("idle")} idle, ${count("waiting")} waiting on you.`;
  }

  /** Opens an entry's session in the Claude app; a decision's card is already on screen, so focus goes there. */
  function openEntry(entry) {
    if (entry.ref) {
      bridge.send({ type: "session-action", action: "open", ref: entry.ref });
      return showToast(`Opening ${entry.title} in the Claude app…`);
    }
    const card = document.querySelector("#question:not([hidden]) button, #ask:not([hidden]) button");
    if (card) return card.focus();
    showToast(entry.needs && needsDan(entry) ? entry.needs : `${entry.title} has nothing to open yet.`);
  }

  // ── Satellites: one per commanded session, orbiting her, each a button. Kept by key so focus survives updates. ──
  const satByKey = new Map();
  function renderSatellites() {
    const sats = godOn ? commanded() : [];
    satellites.hidden = !sats.length;
    const keep = new Set(sats.map((s) => s.key));
    for (const [key, li] of satByKey) {
      if (!keep.has(key)) {
        li.remove();
        satByKey.delete(key);
      }
    }
    sats.forEach((sat, i) => {
      let li = satByKey.get(sat.key);
      if (!li) {
        li = document.createElement("li");
        li.className = "orbit";
        li.innerHTML = '<div class="arm"><div class="upright"><button type="button" class="sat"><span class="dot"></span></button><span class="tip" aria-hidden="true"></span></div></div>';
        li.querySelector("button").addEventListener("click", () => {
          const current = entries.find((e) => e.key === li.dataset.key);
          if (current) openEntry(current);
        });
        li.dataset.key = sat.key;
        satByKey.set(sat.key, li);
      }
      satellites.append(li); // keeps them in entry order
      li.style.setProperty("--start", `${(360 / sats.length) * i + 20}deg`);
      const state = GLYPHS[sat.satellite]?.label ?? sat.satellite;
      const button = li.querySelector("button");
      button.className = `sat ${sat.satellite}`;
      button.setAttribute("aria-label", `${sat.title}, ${state.toLowerCase()}`);
      li.querySelector(".tip").textContent = `${sat.title} · ${state}`;
    });
  }

  function renderEye() {
    eye.hidden = !godOn;
    eye.setAttribute("aria-label", `God mode is on. ${summary()} ${open ? "Fold the slate." : "Show the slate."}`);
    eye.setAttribute("aria-expanded", String(open));
  }

  // ── The slate: cartouches on a small wing of her own, newest nearest the orb. ──
  const cellByKey = new Map();
  let tipSeq = 0;
  let slateWidth = 0;

  /** The cartouche's help text: meaning and session, one line, then time, last action and what it needs from Dan. */
  function fillTip(tip, entry) {
    const head = document.createElement("p");
    head.className = "tip-head";
    const meaning = document.createElement("span");
    meaning.className = "tip-meaning";
    meaning.textContent = entry.meaning;
    head.append(meaning, ` · ${entry.title}`);
    const line = document.createElement("p");
    line.className = "tip-line";
    line.textContent = entry.summary;
    const detail = document.createElement("dl");
    detail.className = "tip-detail";
    for (const [term, value, needs] of [["Time", time(entry.at)], ["Last action", entry.lastAction], ["Needs from you", entry.needs, needsDan(entry)]]) {
      const row = document.createElement("div");
      if (needs) row.className = "needs";
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      row.append(dt, dd);
      detail.append(row);
    }
    tip.replaceChildren(head, line, detail);
  }

  /** Draws the wing for this many cartouches (mirrored when it opens to her left) and places it beside the orb. */
  function renderSlate() {
    const list = onSlate();
    slateWidth = ROOT_PAD + Math.max(1, list.length) * CELL + 8;
    const wing = slateWing({ width: slateWidth, ...WING });
    const art = slateWidth + 16;
    slateArt.setAttribute("viewBox", `0 0 ${art} ${SLATE_HEIGHT}`);
    slateArt.setAttribute("width", String(art));
    slateArt.setAttribute("height", String(SLATE_HEIGHT));
    const feathers = wing.feathers.map((f) => `<polygon points="${f.points}" fill="${f.fill}"/>`).join("");
    const lines = wing.lines.map((l) => `<polyline points="${l.points}" stroke="${l.stroke}" fill="none" stroke-width="1.2"/>`).join("");
    slateArt.innerHTML = `${feathers}${lines}<path class="wing-band" d="${wing.band}"/>`;

    slate.classList.toggle("to-left", side === "left");
    slate.classList.toggle("to-right", side === "right");
    slate.style.width = `${slateWidth}px`;
    slate.style.height = `${SLATE_HEIGHT}px`;
    slate.style.top = `${SLATE_TOP}px`;
    slate.style.left = `${side === "left" ? CENTRE.x - ROOT_OFFSET - slateWidth : CENTRE.x + ROOT_OFFSET}px`;

    const keep = new Set(list.map((e) => e.key));
    for (const [key, li] of cellByKey) {
      if (!keep.has(key)) {
        li.remove();
        cellByKey.delete(key);
      }
    }
    list.forEach((entry, i) => {
      let li = cellByKey.get(entry.key);
      if (!li) {
        li = document.createElement("li");
        li.className = "slate-cell";
        const id = `god-tip-${++tipSeq}`;
        li.innerHTML = `<button type="button" class="cartouche" aria-describedby="${id}"></button><div id="${id}" role="tooltip" class="slate-tip"></div>`;
        li.dataset.key = entry.key;
        li.querySelector("button").addEventListener("click", () => {
          const current = entries.find((e) => e.key === li.dataset.key);
          if (current) openEntry(current);
        });
        li.addEventListener("mouseenter", () => fitTip(li));
        li.addEventListener("focusin", () => fitTip(li));
        li.querySelector("button").addEventListener("keydown", (e) => scrollTip(li, e));
        cellByKey.set(entry.key, li);
      }
      slateCells.append(li);
      const x = ROOT_PAD + CELL * (i + 0.5);
      li.style.left = `${side === "left" ? slateWidth - x : x}px`;
      li.style.top = `${wing.centreY(x)}px`;
      const button = li.querySelector("button");
      if (button.dataset.glyph !== entry.glyph) {
        button.innerHTML = glyphSvg(entry.glyph, { carved: true, size: 22 });
        button.dataset.glyph = entry.glyph;
      }
      button.setAttribute("aria-label", `${entry.meaning}: ${entry.title}`);
      fillTip(li.querySelector(".slate-tip"), entry);
    });
  }

  /**
   * Fits a cartouche's help text in the window as it shows: above the cartouche, or below if there's more room there,
   * capped to that room. Anything longer scrolls (by wheel, or by arrow keys on the cartouche: scrollTip).
   */
  function fitTip(li) {
    const tip = li.querySelector(".slate-tip");
    const cell = li.querySelector("button").getBoundingClientRect();
    const above = cell.top - TIP_GAP - TIP_MARGIN;
    const below = window.innerHeight - cell.bottom - TIP_GAP - TIP_MARGIN;
    tip.style.maxHeight = "none";
    const flip = tip.scrollHeight > above && below > above;
    tip.classList.toggle("below", flip);
    tip.style.maxHeight = `${Math.max(0, Math.floor(flip ? below : above))}px`;
    tip.scrollTop = 0;
  }

  /** Arrow, Page and Home/End keys on a cartouche scroll its help text, when it's long enough to scroll. */
  function scrollTip(li, e) {
    const tip = li.querySelector(".slate-tip");
    if (tip.scrollHeight <= tip.clientHeight) return;
    const page = tip.clientHeight - TIP_LINE;
    const by = { ArrowDown: TIP_LINE, ArrowUp: -TIP_LINE, PageDown: page, PageUp: -page, End: tip.scrollHeight, Home: -tip.scrollHeight }[e.key];
    if (by === undefined) return;
    e.preventDefault();
    tip.scrollBy({ top: by });
  }

  /** How much wider the window must be for the slate and its help text, on the side it opens. */
  function roomNeeded() {
    const orbLeft = (BASE_WIDTH - 320) / 2; // .orb-wrap's left edge in the window
    if (side === "left") return Math.max(0, Math.ceil(-(orbLeft + CENTRE.x - ROOT_OFFSET - slateWidth - TIP_REACH)) + 10);
    return Math.max(0, Math.ceil(orbLeft + CENTRE.x + ROOT_OFFSET + slateWidth + TIP_REACH - BASE_WIDTH) + 10);
  }

  /** The side facing the middle of the screen, from where her centre is on it. */
  function measureSide() {
    const core = talk.getBoundingClientRect();
    const x = window.screenX + core.left + core.width / 2;
    const areaX = Number.isFinite(screen.availLeft) ? screen.availLeft : 0;
    return slateSide(x, areaX, screen.availWidth || screen.width);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => holds.size === 0 && closeSlate(), IDLE_MS);
  }

  /** Pops the slate out (or keeps it out) and restarts the idle countdown. */
  function openSlate() {
    if (!godOn || !onSlate().length) return;
    armIdle();
    if (open) return;
    open = true;
    generation++;
    side = measureSide();
    // Pin her to the side the window doesn't grow on, so adding room moves nothing on screen (orb.css).
    document.body.classList.toggle("room-left", side === "left");
    document.body.classList.toggle("room-right", side === "right");
    renderSlate();
    slate.hidden = false;
    void slate.offsetWidth; // start the unfold from the folded pose
    slate.classList.remove("folded");
    bridge.send({ type: "slate-room", side, width: roomNeeded() });
    renderEye();
    console.info(`[slate] open to her ${side}`);
  }

  /** Folds the slate away (at once with `instant`), then gives the window its room back. */
  function closeSlate(instant = false) {
    if (!open) return;
    open = false;
    const gen = ++generation;
    clearTimeout(idleTimer);
    clearTimeout(graceTimer);
    holds.delete("slate-hover");
    holds.delete("slate-focus");
    slate.classList.add("folded");
    renderEye();
    const finish = () => {
      clearTimeout(foldTimer);
      pendingFold = null;
      if (gen !== generation) return;
      slate.hidden = true;
      bridge.send({ type: "slate-room", side, width: 0 });
      console.info("[slate] folded");
    };
    pendingFold = finish;
    if (instant) finish();
    else foldTimer = setTimeout(finish, FOLD_MS);
  }

  /** Something of hers is pointed at or focused: open and hold. */
  function hold(kind) {
    holds.add(kind);
    clearTimeout(graceTimer);
    if (kind.startsWith("orb")) openSlate();
  }

  /** Let go. Leaving her gives the usual six seconds; leaving the slate folds it after a short grace. */
  function release(kind) {
    if (!holds.delete(kind)) return;
    if (!open) return;
    if (kind.startsWith("orb")) return armIdle();
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => holds.size === 0 && closeSlate(), GRACE_MS);
  }

  /** Moves focus back to the orb without that focus re-opening the slate. */
  function focusOrb() {
    quietFocus = true;
    talk.focus();
    quietFocus = false;
  }

  // Keyboard focus only: clicking her to talk focuses her too, and that shouldn't hold the slate out.
  const keyboardFocus = (el) => el.matches(":focus-visible");
  talk.addEventListener("focus", () => godOn && !quietFocus && keyboardFocus(talk) && hold("orb-focus"));
  talk.addEventListener("blur", () => release("orb-focus"));
  eye.addEventListener("focus", () => keyboardFocus(eye) && hold("orb-eye-focus"));
  eye.addEventListener("blur", () => release("orb-eye-focus"));
  eye.addEventListener("pointerenter", () => hold("orb-eye-hover"));
  eye.addEventListener("pointerleave", () => release("orb-eye-hover"));
  eye.addEventListener("click", () => {
    if (open) return closeSlate();
    if (!onSlate().length) return showToast(`God mode is on. ${summary()}`);
    openSlate();
  });
  // Over and out, not enter and leave: the slate itself takes no pointer events (only its cartouches and help text
  // do), and Chromium sends no enter or leave to it; over and out bubble up from them.
  slate.addEventListener("mouseover", () => hold("slate-hover"));
  slate.addEventListener("mouseout", (e) => {
    if (!slate.contains(e.relatedTarget)) release("slate-hover");
  });
  slate.addEventListener("focusin", () => hold("slate-focus"));
  slate.addEventListener("focusout", (e) => {
    if (!slate.contains(e.relatedTarget)) release("slate-focus");
  });

  bridge.onMessage((m) => {
    if (m.type === "slate-room" && m.width === 0 && !open) document.body.classList.remove("room-left", "room-right");
    else if (m.type === "slate-fold") closeSlate(true);
  });

  window.astraGod = {
    /** God mode from her "mode" message: the toast only when it really changes. */
    setMode(on) {
      const changed = modeSeen && on !== godOn;
      modeSeen = true;
      if (on === godOn) return;
      godOn = on;
      if (!on) {
        closeSlate(true);
        entries = [];
        previous = null;
      }
      renderSatellites();
      renderEye();
      if (changed) showToast(on ? "God mode on: Astra is commanding your sessions." : "God mode off: your sessions are your own again.");
    },
    /** A fresh list from Astra. Anything newly waiting, done or failed pops the slate out and is announced. */
    setEntries(list) {
      entries = Array.isArray(list) ? list.filter((e) => e && typeof e.key === "string" && GLYPHS[e.glyph]) : [];
      const fresh = godOn ? notableChanges(previous, entries) : [];
      previous = godOn ? new Map(entries.map((e) => [e.key, e.glyph])) : null;
      renderSatellites();
      renderEye();
      if (open) {
        if (!onSlate().length) closeSlate();
        else {
          renderSlate();
          bridge.send({ type: "slate-room", side, width: roomNeeded() });
        }
      }
      if (fresh.length) {
        const first = fresh[0];
        news.textContent = `New on the slate: ${first.meaning}, ${first.title}. ${first.summary}`;
        openSlate();
      }
    },
    /** The pointer over her body (true) or not; hovering her opens the slate while God mode is on. */
    pointer(onBody) {
      if (!godOn) return;
      if (onBody && !holds.has("orb-hover")) hold("orb-hover");
      else if (!onBody) release("orb-hover");
    },
    /** Escape: folds the slate. True if it was the slate's Escape (focus was on it or her), so it doesn't also stop her. */
    escape() {
      if (!open) return false;
      const active = document.activeElement;
      const ours = slate.contains(active) || ((active === talk || active === eye) && active.matches(":focus-visible"));
      closeSlate();
      if (ours) focusOrb();
      return ours;
    },
    /** Folds the slate at once (a drag is starting: the window must be its own size again first). */
    foldNow() {
      closeSlate(true);
      pendingFold?.();
    },
    get on() {
      return godOn;
    },
  };
})();
