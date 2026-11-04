/**
 * Feather geometry for the prototype's wings, after Astra's `lowerWings` in
 * orb/orb.js: tiers of gold feathers laid along a curve, with a lapis line
 * under each tier. Original drawing; returns plain SVG data for Vue to render.
 */

const GOLD = "236, 188, 82";
const LAPIS = "42, 74, 168";

const fmt = (n) => Math.round(n * 10) / 10;
const polygon = (points) => points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");

/**
 * The orb's lower wings: three tiers wrapping the bottom of the glyph ring,
 * sweeping up to their tips on both sides. Angles are measured from straight
 * down, so side 1 is the screen's right and -1 its left.
 */
export function orbWings(cx, cy, base) {
  const tiers = [
    { h: 9, end: 1.08, alpha: 0.95 },
    { h: 10, end: 0.9, alpha: 0.8 },
    { h: 12, end: 0.7, alpha: 0.65 },
  ];
  const step = 0.055;
  const at = (theta, r) => [cx + Math.cos(theta) * r, cy + Math.sin(theta) * r];
  const feathers = [];
  const lines = [];
  for (const side of [1, -1]) {
    let r0 = base;
    for (const tier of tiers) {
      for (let a = 0.06; a < tier.end; a += step) {
        const f = (a - 0.06) / (tier.end - 0.06);
        const h = tier.h * (1 - f * 0.35);
        const th0 = Math.PI / 2 - side * (a - step * 0.42);
        const th1 = Math.PI / 2 - side * (a + step * 0.42);
        feathers.push({
          points: polygon([at(th0, r0), at(th1, r0), at(th1 + side * step * 0.15, r0 + h), at(th0 + side * step * 0.15, r0 + h)]),
          fill: `rgba(${GOLD}, ${fmt(tier.alpha * (1 - f * 0.5) * 0.85 * 100) / 100})`,
        });
      }
      const arc = [];
      for (let a = 0.06; a <= tier.end + 0.001; a += 0.04) arc.push(at(Math.PI / 2 - side * a, r0 + tier.h));
      lines.push({ points: polygon(arc), stroke: `rgba(${LAPIS}, 0.8)` });
      r0 += tier.h - 1;
    }
  }
  return { feathers, lines };
}

/** Where a glyph button sits on a wing: `angle` from straight down, `side` 1 screen right, -1 left. */
export function wingPoint(cx, cy, r, angle, side) {
  return { x: cx + side * Math.sin(angle) * r, y: cy + Math.cos(angle) * r };
}

/**
 * The slate's wing: a lapis band rising gently from its root (x = 0, next to
 * the orb) to its tip, a covert tier of short feathers above it and three
 * tiers of flight feathers below. Drawn root-left; mirror it for a slate
 * that opens to her left.
 */
export function slateWing({ width, rootY, lift, rootHalf, tipHalf }) {
  const centreY = (x) => rootY - lift * (x / width) ** 2;
  const half = (x) => rootHalf + (tipHalf - rootHalf) * (x / width);
  const top = (x) => centreY(x) - half(x);
  const bottom = (x) => centreY(x) + half(x);
  const xs = [];
  for (let x = 0; x <= width; x += 8) xs.push(x);
  if (xs.at(-1) !== width) xs.push(width);

  const topEdge = xs.map((x) => [x, top(x)]);
  const bottomEdge = xs.map((x) => [x, bottom(x)]).reverse();
  const tipX = width + tipHalf * 0.9;
  const band =
    `M${polygon(topEdge).replaceAll(" ", " L")}` +
    ` Q${fmt(tipX)},${fmt(centreY(width))} ${fmt(width)},${fmt(bottom(width))}` +
    ` L${polygon(bottomEdge).replaceAll(" ", " L")} Z`;

  const feathers = [];
  const lines = [];
  const step = 11;
  const layTier = (edge, h, end, alpha, direction) => {
    for (let x = 2; x < width * end; x += step) {
      const f = x / (width * end);
      const fh = h * (1 - f * 0.4) * direction;
      const x0 = x - step * 0.42;
      const x1 = x + step * 0.42;
      const slant = 3.5;
      feathers.push({
        points: polygon([[x0, edge(x0)], [x1, edge(x1)], [x1 + slant, edge(x1) + fh], [x0 + slant, edge(x0) + fh]]),
        fill: `rgba(${GOLD}, ${fmt(alpha * (1 - f * 0.5) * 100) / 100})`,
      });
    }
  };
  // Coverts: one short tier above the band.
  layTier((x) => top(x) + 1, 7, 0.92, 0.55, -1);
  // Flight feathers: three tiers below, each shorter towards the tip.
  const tiers = [
    { h: 9, end: 1, alpha: 0.95 },
    { h: 10, end: 0.82, alpha: 0.8 },
    { h: 12, end: 0.62, alpha: 0.65 },
  ];
  let offset = -1;
  for (const tier of tiers) {
    const edge = (x) => bottom(x) + offset;
    layTier(edge, tier.h, tier.end, tier.alpha, 1);
    const line = [];
    for (let x = 0; x <= width * tier.end; x += 8) line.push([x, edge(x) + tier.h * (1 - (x / (width * tier.end)) * 0.4)]);
    lines.push({ points: polygon(line), stroke: `rgba(${LAPIS}, 0.85)` });
    offset += tier.h - 2;
  }
  return { band, feathers, lines, centreY };
}
