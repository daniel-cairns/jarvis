// Astra's glyphs as gold line-art SVG, for the panels (the orb's ring draws the same forms on its canvas in orb.js).
// Ancient forms, drawn fresh here. Each is the inside of a 24×24 viewBox, stroked in currentColor.
(() => {
  const RING = {
    ankh: '<ellipse cx="12" cy="8.4" rx="2.3" ry="3.1"/><path d="M12 11.5V20M8 12.8h8"/>',
    eye: '<path d="M6.4 12Q12 7.2 17.6 12Q12 15.6 6.4 12Z"/><circle cx="12" cy="12" r="1.45"/><path d="M11.2 14.4 10 19.2"/>',
    water: '<path d="M6.4 8.8 7.8 7.4 10.6 10.2 13.4 7.4 16.2 10.2 17.6 8.8M6.4 12 7.8 10.6 10.6 13.4 13.4 10.6 16.2 13.4 17.6 12M6.4 15.2 7.8 13.8 10.6 16.6 13.4 13.8 16.2 16.6 17.6 15.2"/>',
    djed: '<path d="M12 4v16M8.4 5.6h7.2M8.4 8.2h7.2M8.4 10.8h7.2M8.8 20h6.4"/>',
    sun: '<circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1"/>',
    reed: '<path d="M12 20V9.6Q16 7.2 13.2 4Q10.4 7.2 12 9.6"/>',
  };

  /**
   * The water clock (clepsydra): a vessel wider at the top, marked with hours, water slowly falling inside, and a
   * drop leaving the outlet. Animated parts carry classes (glyph.css) so reduced motion can still them.
   */
  const CLEPSYDRA =
    '<path d="M6.5 5.5h11M7.3 5.5 9.4 17.2h5.2l2.1-11.7"/>' +
    '<path class="g-level" d="M8.2 9.4h7.6"/>' +
    '<path d="M8.9 12.4h.9M14.2 12.4h.9M9.4 15h.8M13.8 15h.8"/>' +
    '<path d="M12 17.2v1.3"/>' +
    '<path class="g-drop" d="M12 19.6q-.9 1.3 0 2.1q.9-.8 0-2.1Z"/>';

  /** The sun disc with short rays (the Aten), its rays turning slowly and shimmering. */
  const ATEN =
    '<circle cx="12" cy="12" r="3.6"/><circle cx="12" cy="12" r=".9"/>' +
    '<g class="g-rays"><path d="M12 3.6v2.4M12 18v2.4M3.6 12h2.4M18 12h2.4M6.1 6.1l1.7 1.7M16.2 16.2l1.7 1.7M6.1 17.9l1.7-1.7M16.2 7.8l1.7-1.7"/></g>';

  /** The shen ring (eternity, rest): a loop of rope tied at its base. For a session at rest: idle or done. */
  const SHEN = '<circle cx="12" cy="10" r="5.4"/><path d="M6.8 17.6h10.4M10 15.2v2.4M14 15.2v2.4"/>';

  /** A djed pillar knocked askew, with a crack: something failed or was stopped. */
  const BROKEN =
    '<path d="M11.4 4.2 12.6 11M8.2 6.4l6.8-1.2M8.6 9l6.8-1.2"/>' +
    '<path d="M10.6 12.6 12 13.4 13.4 12.6"/>' +
    '<path d="M12 15v5M8.8 20h6.4M9.2 16.6h5.6"/>';

  /** A papyrus scroll: plans written out before acting. For plan mode. */
  const SCROLL =
    '<path d="M8 6.5h9.5v11H8"/><path d="M8 6.5a1.6 1.6 0 0 0 0 3.2h1.2M17.5 14.3a1.6 1.6 0 0 1 0 3.2"/>' +
    '<path d="M10.6 11.4h4.6M10.6 14h3.4"/>';

  const ALL = { ...RING, clepsydra: CLEPSYDRA, aten: ATEN, shen: SHEN, broken: BROKEN, scroll: SCROLL };

  /** An inline SVG for a glyph (aria-hidden: the meaning is always given in text alongside). */
  function svg(name, extraClass = "") {
    const body = ALL[name] ?? RING.sun;
    return `<svg class="glyph g-${name} ${extraClass}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  /** Which glyph shows a session's status (sessions panel). Shapes differ, so colour is never the only signal. */
  const STATUS = { working: "aten", waiting: "reed", idle: "shen", done: "shen", failed: "broken", stopped: "broken" };
  /** Which glyph shows a permission mode, where one reads well; the others are text only. */
  const MODE = { auto: "water", plan: "scroll", acceptEdits: "ankh" };

  const api = { RING_NAMES: Object.keys(RING), names: Object.keys(ALL), svg, STATUS, MODE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.astraGlyphs = api;
})();
