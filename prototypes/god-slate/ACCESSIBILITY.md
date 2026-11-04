# Accessibility notes

Ratios are WCAG 2 contrast, measured by `npm run contrast` (`scripts/contrast.mjs`).
Text needs 4.5:1 (AA); non-text UI (glyph strokes, dots, focus rings) needs 3:1.
"Noise peak" is the lightest a feTurbulence speck can lift the lightest basalt stop.

| Pair | Basalt dark #161d1b | Basalt light #27312e | Noise peak #3f4a46 | Needs |
|---|---|---|---|---|
| Label text (ink) #eef3ef | 15.26 | 11.95 | 8.21 | 4.5 |
| Secondary text (muted) #b9c7c1 | 9.79 | 7.67 | 5.27 | 4.5 |
| Gold accent #ecbc52 | 9.69 | 7.59 | 5.21 | 3 |
| Gold leaf, darkest stop #d4a443 | 7.50 | 5.87 | 4.03 | 3 |
| Focus ring (reactor) #46e0d6 | 10.52 | 8.24 | 5.66 | 3 |

| Pair | Ratio | Needs |
|---|---|---|
| Satellite working #ffd978 on page #0a1020 | 13.94 | 3 |
| Satellite idle (dim) #a88a4a on page | 5.78 | 3 |
| Satellite waiting (amber) #ff9f1c on page | 9.23 | 3 |
| Label text (ink) on page | 16.88 | 4.5 |
| Secondary text (muted) on page | 10.83 | 4.5 |
| Dark text #1a1204 on gold button #ecbc52 | 10.49 | 4.5 |

All pass. Gold would pass as text too, but it's kept for accents (edges, glyph leaf, markers); every label is near-white ink.

## Checks
- **Glyphs never stand alone.** Every glyph SVG is `aria-hidden`; each cartouche and plate row carries a visible status label ("Working", "Waiting on you", ...), and the plain-English line under it.
- **Satellites** are real `<button>`s named like "Checkout redesign, working", with a visible tooltip on hover and keyboard focus. Waiting adds an amber ring as well as the colour, and a visible key sits under the orb. The orbit pauses while the pointer or focus is on a satellite.
- **Cartouches** are `<button>`s with `aria-pressed` (click, Enter or Space pins the detail), `aria-controls` to the detail band, and `aria-describedby` to their plain-English line. The detail band is `aria-live="polite"`.
- **Focus** is a 3px turquoise ring on panels and controls, and a white ring with a dark halo over the orb.
- **Tab order** follows reading order: God mode toggle, the three question controls, Add a mock event, sun/Eye, satellites, cartouches.
- **Reduced motion**: `prefers-reduced-motion` or the in-page "Reduce motion" checkbox stops the ring turning, the satellites orbiting, the orb breathing, the dots pulsing and the chisel/glint. Things only fade in and out.
- **Toasts** are announced through a `role="status"` region.
