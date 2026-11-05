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
  /** How far the slate's flight feathers swing out at its root, to meet her lower wings' tips (radians). */
  const TILT = 0.6;
  const polygon = (points) => points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
  const GOLD = "236, 188, 82";
  const LAPIS = "42, 74, 168";

  /**
   * The slate's wing (after the prototype's wings.js): a lapis band rising gently from its root (next to the orb) to its
   * tip, a covert tier of short feathers above it and three tiers of flight feathers below. With `hug` (her centre in
   * the wing's coordinates and a radius) the root edge lies on that circle round her, the path of her lower wings, so
   * the slate grows out of them; the band's foot sits at x = 0. Feathers are cut like her own wings' (orb.js wing): narrow, leaning back towards
   * her at their tips. Drawn root left; mirror it for a slate that opens to her left. Returns plain SVG data.
   */
  function slateWing({ width, rootY, lift, rootHalf, tipHalf, hug }) {
    const along = (x) => Math.max(0, x) / width;
    const centreY = (x) => rootY - lift * along(x) ** 2;
    const half = (x) => rootHalf + (tipHalf - rootHalf) * along(x);
    const top = (x) => centreY(x) - half(x);
    const bottom = (x) => centreY(x) + half(x);
    // The root edge: on the circle round her centre (her lower wings' path), meeting x = 0 at the band's foot.
    const foot = bottom(0);
    const rootX = (y) =>
      hug ? hug.x + Math.sqrt(Math.max(0, hug.r ** 2 - (y - hug.y) ** 2)) - (hug.x + Math.sqrt(Math.max(0, hug.r ** 2 - (foot - hug.y) ** 2))) : 0;
    // Where the root arc meets the top edge (a few fixed-point steps: the top edge is nearly flat there).
    let headX = 0;
    for (let i = 0; i < 4; i++) headX = rootX(top(headX));
    const span = (from) => {
      const xs = [];
      for (let x = from; x < width; x += 8) xs.push(x);
      xs.push(width);
      return xs;
    };

    const topEdge = span(headX).map((x) => [x, top(x)]);
    const bottomEdge = span(0).map((x) => [x, bottom(x)]).reverse();
    const rootEdge = [];
    for (let k = 1; k < 6; k++) {
      const y = foot + ((top(headX) - foot) * k) / 6;
      rootEdge.push([rootX(y), y]);
    }
    const tipX = width + tipHalf * 0.9;
    const band =
      `M${polygon(topEdge).split(" ").join(" L")}` +
      ` Q${fmt(tipX)},${fmt(centreY(width))} ${fmt(width)},${fmt(bottom(width))}` +
      ` L${polygon(bottomEdge).split(" ").join(" L")}` +
      ` L${polygon(rootEdge).split(" ").join(" L")} Z`;

    const feathers = [];
    const lines = [];
    const step = 6;
    const lean = 1.2; // tips lean back towards her, as on her wings
    const layTier = (edge, from, h, end, alpha, direction) => {
      for (let x = from; x < width * end; x += step) {
        const f = x / (width * end);
        const fh = h * (1 - f * 0.4);
        const x1 = x + 5;
        // Square to the band's arch, tips leaning back towards her. Near her, the flight feathers swing out away from
        // her (up to TILT), as her lower wings' tips do, so the two meet; they straighten by mid-band. Longer as they
        // swing, so each tier still reaches the next.
        const slope = edge(x + 2.5 + 0.5) - edge(x + 2.5 - 0.5);
        const len = Math.hypot(1, slope);
        let [nx, ny] = [(-slope / len) * direction, (1 / len) * direction];
        let reach = 1;
        if (hug && direction > 0) {
          const blend = Math.min(1, x / (width * 0.5));
          const tilt = TILT * (1 - blend * blend * (3 - 2 * blend));
          [nx, ny] = [nx * Math.cos(tilt) + ny * Math.sin(tilt), -nx * Math.sin(tilt) + ny * Math.cos(tilt)];
          reach = 1 / ny;
        }
        const [tx, ty] = [1 / len, slope / len];
        const out = ([px, py]) => [px + nx * fh * reach - tx * lean, py + ny * fh * reach - ty * lean];
        const a = [x, edge(x)];
        const b = [x1, edge(x1)];
        feathers.push({
          points: polygon([a, b, out(b), out(a)]),
          fill: `rgba(${GOLD}, ${fmt(alpha * (1 - f * 0.55) * 100) / 100})`,
        });
      }
    };
    layTier((x) => top(x) + 1, headX + 2, 6, 0.92, 0.55, -1);
    const tiers = [
      { h: 8, end: 1, alpha: 0.95 },
      { h: 10, end: 0.8, alpha: 0.8 },
      { h: 13, end: 0.58, alpha: 0.65 },
    ];
    let offset = -1;
    for (const tier of tiers) {
      const edge = (x) => bottom(x) + offset;
      // Each tier starts on the same circle as the root edge, so the feathers carry on her lower wings' line, but no
      // further in than the band's foot: past it they'd cover her lower wings' buttons.
      layTier(edge, Math.max(0, rootX(edge(0) + tier.h / 2)) + 1.5, tier.h, tier.end, tier.alpha, 1);
      const line = [];
      for (let x = 0; x <= width * tier.end; x += 4) line.push([x, edge(x) + tier.h * (1 - (x / (width * tier.end)) * 0.4)]);
      lines.push({ points: polygon(line), stroke: `rgba(${LAPIS}, 0.85)` });
      offset += tier.h - 1;
    }
    return { band, feathers, lines, centreY, top, bottom, rootX };
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

  const api = { GLYPHS, RING_GLYPHS, SATELLITE_STATES, slateSide, needsDan, notableChanges, slateWing, glyphSvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.astraGodGlyphs = api;
})(globalThis);
