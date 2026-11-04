/**
 * Measures WCAG 2 contrast ratios for the prototype's colour pairs.
 * Run with `npm run contrast`. Text needs 4.5:1, non-text UI 3:1.
 */
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255]
    .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Basalt: gradient stops, plus the lightest a noise speck can make the lightest stop.
const BASALT = { "basalt dark #161d1b": "#161d1b", "basalt light #27312e": "#27312e", "noise peak #3f4a46": "#3f4a46" };
const PAGE = { "page #0a1020": "#0a1020" };

const checks = [
  ["Label text (ink) #eef3ef", "#eef3ef", BASALT, 4.5],
  ["Secondary text (muted) #b9c7c1", "#b9c7c1", BASALT, 4.5],
  ["Gold accent #ecbc52", "#ecbc52", BASALT, 3],
  ["Gold leaf, darkest stop #d4a443", "#d4a443", BASALT, 3],
  ["Focus ring (reactor) #46e0d6", "#46e0d6", BASALT, 3],
  ["Satellite working #ffd978", "#ffd978", PAGE, 3],
  ["Satellite idle (dim) #a88a4a", "#a88a4a", PAGE, 3],
  ["Satellite waiting (amber) #ff9f1c", "#ff9f1c", PAGE, 3],
  ["Label text (ink) on page", "#eef3ef", PAGE, 4.5],
  ["Secondary text (muted) on page", "#b9c7c1", PAGE, 4.5],
  ["Dark text #1a1204 on gold button", "#1a1204", { "gold #ecbc52": "#ecbc52" }, 4.5],
];

for (const [name, fg, bgs, min] of checks) {
  const cells = Object.entries(bgs).map(([bgName, bg]) => {
    const r = ratio(fg, bg);
    return `${bgName}: ${r.toFixed(2)}:1 ${r >= min ? "pass" : "FAIL"}`;
  });
  console.log(`${name} (needs ${min}:1) | ${cells.join(" | ")}`);
}
