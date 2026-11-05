// Help text for the glyph buttons on her lower wings: a small tooltip in her glass, on hover and on keyboard focus,
// saying what the button does and its shortcut. Each is role="tooltip" and named by its button's aria-describedby.
// The pure parts (what each says, where it goes) are shared with the tests, so they use no DOM.
(function (root) {
  const GAP = 7; // between the button and its tip
  const MARGIN = 4; // kept clear of the window's edges
  const GRACE_MS = 140; // lets the pointer cross from the button onto its tip

  /** What each wing button's tip says for its current state, and its keyboard shortcut (if it has one). */
  const TIPS = {
    stop: (b) => ({ text: b.disabled ? "Stop Astra (nothing to stop)" : "Stop Astra", keys: "Esc", note: "⌃⌥Esc from any app" }),
    record: (b) => ({ text: b.pressed ? "Stop the transcript" : "Record a transcript" }),
    "type-only": (b) => ({ text: b.pressed ? "Back to voice: mic and speech on" : "Type only: mic off, silent replies" }),
    minimise: () => ({ text: "Minimise (reopen from the menu bar)" }),
    front: () => ({ text: "Bring all panels forward" }),
    eye: (b) => (b.expanded ? { text: "Fold the slate", keys: "Esc" } : { text: "Show the slate: sessions and loops" }),
  };

  /** The tip for button `id` in state { disabled, pressed, expanded }, or null for a button with no tip. */
  function tipFor(id, state = {}) {
    return TIPS[id] ? TIPS[id](state) : null;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /**
   * Where a tip of `size` goes beside the `anchor` rect inside a `viewport` of { width, height }: centred above it if it
   * fits, else below, else to whichever side has room; always kept inside the window.
   */
  function placeTip({ anchor, size, viewport }) {
    const maxLeft = Math.max(MARGIN, viewport.width - MARGIN - size.width);
    const maxTop = Math.max(MARGIN, viewport.height - MARGIN - size.height);
    const centredLeft = clamp(anchor.left + anchor.width / 2 - size.width / 2, MARGIN, maxLeft);
    const above = anchor.top - GAP - size.height;
    if (above >= MARGIN) return { left: centredLeft, top: above, where: "above" };
    const below = anchor.top + anchor.height + GAP;
    if (below + size.height <= viewport.height - MARGIN) return { left: centredLeft, top: below, where: "below" };
    const top = clamp(anchor.top + anchor.height / 2 - size.height / 2, MARGIN, maxTop);
    const right = anchor.left + anchor.width + GAP;
    if (right + size.width <= viewport.width - MARGIN) return { left: right, top, where: "right" };
    return { left: clamp(anchor.left - GAP - size.width, MARGIN, maxLeft), top, where: "left" };
  }

  /**
   * Wires a tip to each of `buttons`. Hover is fed from the window's mousemove (`pointer`), since a disabled button
   * gets no pointer events of its own; keyboard focus shows it too. A tip takes no pointer events itself (so one
   * showing over a neighbouring button never blocks it), but the pointer over a visible tip holds it open.
   */
  function create(doc, buttons) {
    const win = doc.defaultView;
    const tips = new Map();
    for (const button of buttons) {
      const tip = doc.createElement("div");
      tip.id = `wing-tip-${button.id}`;
      tip.className = "wing-tip";
      tip.setAttribute("role", "tooltip");
      tip.hidden = true;
      tip.dataset.for = button.id;
      doc.body.append(tip);
      button.setAttribute("aria-describedby", tip.id);
      tips.set(button, tip);
      fill(button, tip);
    }
    let hovered = null;
    let focused = null;
    let shown = null;
    let dismissed = null;
    let graceTimer = 0;

    function fill(button, tip) {
      const t = tipFor(button.id, {
        disabled: button.disabled,
        pressed: button.getAttribute("aria-pressed") === "true",
        expanded: button.getAttribute("aria-expanded") === "true",
      });
      tip.replaceChildren(t.text);
      if (t.keys) {
        const kbd = doc.createElement("kbd");
        kbd.textContent = t.keys;
        tip.append(" ", kbd);
      }
      if (t.note) {
        const note = doc.createElement("span");
        note.className = "wing-tip-note";
        note.textContent = t.note;
        tip.append(note);
      }
    }

    /** Shows the tip of whichever button is hovered, else focused (one at a time), unless Escape dismissed it. */
    function update() {
      const want = hovered ?? focused;
      const next = want && want !== dismissed && !want.hidden ? want : null;
      if (next === shown) return;
      if (shown) tips.get(shown).hidden = true;
      shown = next;
      if (!shown) return;
      fill(shown, tips.get(shown));
      tips.get(shown).hidden = false;
      place();
    }

    /** Puts the visible tip beside its button (again after the button or the window moves). */
    function place() {
      if (!shown) return;
      const tip = tips.get(shown);
      const at = placeTip({
        anchor: shown.getBoundingClientRect(),
        size: { width: tip.offsetWidth, height: tip.offsetHeight },
        viewport: { width: win.innerWidth, height: win.innerHeight },
      });
      tip.style.left = `${Math.round(at.left)}px`;
      tip.style.top = `${Math.round(at.top)}px`;
      tip.dataset.where = at.where;
    }

    for (const button of buttons) {
      button.addEventListener("focus", () => {
        if (!button.matches(":focus-visible")) return;
        focused = button;
        update();
      });
      button.addEventListener("blur", () => {
        if (focused === button) focused = null;
        if (dismissed === button) dismissed = null;
        update();
      });
      // The text follows the button's state (recording, type-only, the slate folded or out).
      new win.MutationObserver(() => {
        fill(button, tips.get(button));
        if (button === shown) place();
        if (button.hidden && button === shown) update();
      }).observe(button, { attributes: true, attributeFilter: ["disabled", "aria-pressed", "aria-expanded", "hidden"] });
    }
    win.addEventListener("resize", place);

    return {
      /** The element under the pointer at (x, y), or null: a wing button, or the pointer on a visible tip, holds it open. */
      pointer(el, x, y) {
        const button = el?.closest?.("button");
        const next = button && tips.has(button) ? button : this.covers(x, y) ? shown : null;
        clearTimeout(graceTimer);
        if (next === hovered) return;
        if (next && next !== dismissed) dismissed = null;
        if (next || !hovered) {
          hovered = next;
          return update();
        }
        graceTimer = setTimeout(() => {
          hovered = null;
          update();
        }, GRACE_MS);
      },
      /**
       * Escape hides a visible tip. True when focus is on that tip's button, so the key does nothing else (the next
       * Escape stops her as usual); a tip shown by hover alone hides and lets Escape carry on.
       */
      escape(target) {
        if (!shown) return false;
        const ours = target === shown;
        dismissed = shown;
        update();
        return ours;
      },
      /** Whether (x, y) is on the visible tip: it counts as part of her for click-through while it shows. */
      covers(x, y) {
        if (!shown || !Number.isFinite(x)) return false;
        const r = tips.get(shown).getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      },
      place,
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { tipFor, placeTip, GAP, MARGIN };
  else root.astraWingTips = { create, tipFor, placeTip };
})(globalThis);
