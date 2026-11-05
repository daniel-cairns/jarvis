// God mode's glyph set and the pure rules behind the slate (god.js), shared with the tests, so no DOM.
// Original artwork from the god-slate prototype: each glyph is a list of single strokes on a 48 × 48 grid, so the
// canvas ring (orb.js, via Path2D) and the slate's SVG cartouches draw exactly the same forms.
(function (root) {
  /** The fixed set. `label` is the plain-English meaning that always travels with the glyph. */
  const GLYPHS = {
    working: {
      label: "Working",
      motif: "flowing water",
      strokes: [
        "M6 15 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5",
        "M6 25 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5",
        "M6 35 l6 -5 l6 5 l6 -5 l6 5 l6 -5 l6 5",
      ],
    },
    idle: {
      label: "Idle",
      motif: "reed",
      strokes: ["M24 44 C24 33 23.5 20 22 8", "M22 8 C29 9 32 14 29 21", "M23 19 C16 20 14 25 17 30", "M18 44 H30"],
    },
    waiting: {
      label: "Waiting on you",
      motif: "eye",
      strokes: [
        "M5 22 C13 11 35 11 43 22",
        "M5 22 C13 30 35 30 43 22",
        "M24 17.5 a4.5 4.5 0 1 0 0.01 0",
        "M19 28 L16 38 C15 42 19 43 21 40",
        "M30 27 C33 31 37 33 41 32",
      ],
    },
    done: {
      label: "Done",
      motif: "ankh-style loop",
      strokes: ["M24 23 C15 19 16 5 24 5 C32 5 33 19 24 23 Z", "M11 25 H37", "M24 25 V44"],
    },
    failed: {
      label: "Failed",
      motif: "broken staff",
      strokes: ["M12 44 L21 27", "M26 20 L34 7 C36 3 41 4 40 9", "M19 20 L14 17", "M28 27 L33 30", "M23 22 L24.5 25"],
    },
    teardown: {
      label: "Tearing down",
      motif: "scarab",
      strokes: [
        "M24 15 C33 15 35 40 24 42 C13 40 15 15 24 15 Z",
        "M19 15 C19 8 29 8 29 15",
        "M17 23 H31",
        "M24 23 V42",
        "M16 27 L8 23",
        "M32 27 L40 23",
        "M16 35 L8 39",
        "M32 35 L40 39",
      ],
    },
    note: {
      label: "Brain note saved",
      motif: "papyrus scroll",
      strokes: [
        "M10 13 C10 9 16 9 16 13 V37 C16 41 10 41 10 37 Z",
        "M16 11 H38 V35 H16",
        "M21 19 H33",
        "M21 25 H33",
        "M21 31 H29",
      ],
    },
    background: {
      label: "Background run",
      motif: "bird in flight",
      strokes: ["M4 21 C11 13 19 15 24 24", "M24 24 C29 15 37 13 44 21", "M24 24 V33", "M20 36 L24 33 L28 36"],
    },
    researching: {
      label: "Researching",
      motif: "Thoth's ibis",
      strokes: [
        "M28 4.5 a4.5 4.5 0 1 0 0.01 0",
        "M20.5 11 C22 18.5 34 18.5 35.5 11",
        "M35 28 a7 6 0 1 1 -14 0 a7 6 0 1 1 14 0",
        "M21.5 26 C14 28 9 34 7 44 C12 36 16 32.5 22 31",
        "M27 25.3 a1.2 1.2 0 1 0 0.01 0",
        "M28 34 V44",
      ],
    },
  };

  /** The order the glyphs are carved round God mode's ring (twice round). */
  const RING_GLYPHS = ["working", "researching", "done", "background", "idle", "note", "waiting", "teardown"];

  /** Satellite states: the dot's look for a commanded session. */
  const SATELLITE_STATES = ["working", "idle", "waiting"];

  /**
   * Which side of the orb the slate opens on: the one facing the middle of the screen, so it always has room. On the
   * right half of the screen it opens to her left, and vice versa. Exactly in the middle, it opens to her left.
   */
  function slateSide(orbCentreX, areaX, areaWidth) {
    return orbCentreX >= areaX + areaWidth / 2 ? "left" : "right";
  }

  /** Whether an entry asks something of Dan (its "needs" line isn't "Nothing…"). */
  const needsDan = (entry) => !!entry && typeof entry.needs === "string" && !/^nothing/i.test(entry.needs);

  /** Glyphs worth popping the slate out for when an entry newly shows one. */
  const NOTABLE = new Set(["waiting", "done", "failed"]);

  /**
   * The slate entries that are news since `previous` (key → glyph from the last update): new or changed to waiting,
   * done or failed. The first update after God mode turns on is never news (pass `previous` as null).
   */
  function notableChanges(previous, entries) {
    if (!previous) return [];
    return entries.filter((e) => e.onSlate && NOTABLE.has(e.glyph) && previous.get(e.key) !== e.glyph);
  }

  const fmt = (n) => Math.round(n * 10) / 10;
  const polygon = (points) => points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
  const GOLD = "236, 188, 82";
  const LAPIS = "42, 74, 168";

  /**
   * The slate: a lapis band on an arc around her centre, just outside her lower wings (orb.js lowerWings), so it reads as
   * one more tier of them. It starts below her at `start` (radians round from straight down, as her wings measure it)
   * and sweeps up her side, `cellArc` px of arc per cartouche, with three tiers of feathers outside it cut and leaning
   * like her wings'. Drawn to her right with her centre at (0, 0), y down; mirror it for a slate that opens to her left.
   * Returns plain SVG data, each cartouche's centre and angle, and how far the drawing reaches.
   */
  function slateArc({ count, inner, outer, start, cellArc, pad = 0.05 }) {
    const at = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];
    const mid = (inner + outer) / 2;
    const cellAngle = cellArc / mid;
    const cells = Array.from({ length: count }, (_, i) => {
      const angle = start + pad + cellAngle * (i + 0.5);
      const [x, y] = at(angle, mid);
      return { x, y, angle };
    });
    const end = start + pad * 2 + cellAngle * Math.max(1, count);
    const arcPoints = (r, from, to) => {
      const n = Math.max(2, Math.ceil(((to - from) * r) / 6));
      return Array.from({ length: n + 1 }, (_, k) => at(from + ((to - from) * k) / n, r));
    };
    // Round cap at the far end (a half-circle across the band), straight radial cut at the root.
    const capR = (outer - inner) / 2;
    const band =
      `M${polygon(arcPoints(outer, start, end)).split(" ").join(" L")}` +
      ` A${fmt(capR)},${fmt(capR)} 0 0 0 ${polygon([at(end, inner)])}` +
      ` L${polygon(arcPoints(inner, end, start)).split(" ").join(" L")} Z`;

    const feathers = [];
    const lines = [];
    const tiers = [
      { h: 7, end: 1, alpha: 0.95 },
      { h: 8, end: 0.8, alpha: 0.8 },
      { h: 10, end: 0.6, alpha: 0.65 },
    ];
    let r0 = outer - 1;
    for (const tier of tiers) {
      const stop = start + (end - start) * tier.end;
      const step = 6 / r0;
      for (let a = start + step * 0.5; a < stop; a += step) {
        const f = (a - start) / (stop - start);
        const h = tier.h * (1 - f * 0.35);
        const a0 = a - step * 0.42;
        const a1 = a + step * 0.42;
        const lean = step * 0.15; // tips lean back towards the root, as on her lower wings
        feathers.push({
          points: polygon([at(a0, r0), at(a1, r0), at(a1 - lean, r0 + h), at(a0 - lean, r0 + h)]),
          fill: `rgba(${GOLD}, ${fmt(tier.alpha * (1 - f * 0.5) * 100) / 100})`,
        });
      }
      lines.push({ points: polygon(arcPoints(r0 + tier.h, start, stop)), stroke: `rgba(${LAPIS}, 0.85)` });
      r0 += tier.h - 1;
    }
    // How far it reaches from her centre: right, up and down (feathers included).
    const all = [...arcPoints(r0, start, end), ...arcPoints(inner, start, end), at(end, mid + capR)];
    const reach = {
      right: Math.max(...all.map(([x]) => x)) + capR,
      top: Math.min(...all.map(([, y]) => y)) - capR,
      bottom: Math.max(...all.map(([, y]) => y)),
    };
    return { band, feathers, lines, cells, end, reach };
  }

  /**
   * An inline SVG for a glyph. Always aria-hidden: whoever shows it gives its meaning in text alongside. `carved`
   * adds the inset cut (dark top-left, light bottom-right) under the gold leaf.
   */
  function glyphSvg(name, { carved = false, size = 24 } = {}) {
    const strokes = (GLYPHS[name] ?? GLYPHS.idle).strokes;
    const paths = (cls) => `<g class="${cls}">${strokes.map((d) => `<path d="${d}"/>`).join("")}</g>`;
    const cut = carved ? `<g transform="translate(-1 -1)">${paths("cut-shadow")}</g><g transform="translate(1 1)">${paths("cut-light")}</g>` : "";
    return `<svg class="god-glyph" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" focusable="false">${cut}${paths("leaf")}</svg>`;
  }

  const api = { GLYPHS, RING_GLYPHS, SATELLITE_STATES, slateSide, needsDan, notableChanges, slateArc, glyphSvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.astraGodGlyphs = api;
})(globalThis);
