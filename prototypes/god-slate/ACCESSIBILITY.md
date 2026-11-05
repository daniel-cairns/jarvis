# Accessibility notes

Ratios are WCAG 2 contrast, measured by `npm run contrast` (`scripts/contrast.mjs`).
Text needs 4.5:1 (AA); non-text UI (glyph strokes, cartouche edges, dots, focus rings) needs 3:1.
Translucent fills are measured as the opaque colour they make over what sits beneath them.

## The slate's tooltip (help text)

| Pair, on tooltip #060a18 | Ratio | Needs |
|---|---|---|
| Body text (ink) #eef3ef | 17.57 | 4.5 |
| Line and labels (muted) #b9c7c1 | 11.28 | 4.5 |
| Glyph meaning (gold) #ecbc52 | 11.16 | 4.5 |
| Needs-you bar (amber) #ff9f1c | 9.61 | 3 |

## Gold on the slate's lapis band

| Pair | Lapis top #1d3a8a | Lapis deep #0d1c4a | Cartouche on hover #3e4f81 | Needs |
|---|---|---|---|---|
| Cartouche edge (gold) #ecbc52 | 5.87 | 9.27 | 4.50 | 3 |
| Gold leaf, darkest stop #d4a443 | 4.54 | 7.17 | 3.48 | 3 |
| Focus ring (reactor) #46e0d6 | 6.37 | 10.06 | 4.88 | 3 |

The lapis top is the worst case at rest: inside a cartouche a 45% dark fill sits over it, so the glyph's real background is darker still. Hover (16% gold over the lapis top) is the lightest a cartouche gets.

## Orb, wings and page

| Pair | Ratio | Needs |
|---|---|---|
| Gold leaf on a wing button (Eye, sun) #d4a443 on #13245a | 6.44 | 3 |
| Gold feathers, full strength #ecbc52 on page #0a1020 | 10.72 | 3 |
| Orb and wing-button focus ring, white on page | 18.96 | 3 |
| Satellite working #ffd978 on page | 13.94 | 3 |
| Satellite idle (dim) #a88a4a on page | 5.78 | 3 |
| Satellite waiting (amber) #ff9f1c on page | 9.23 | 3 |
| Label text (ink) on page | 16.88 | 4.5 |
| Secondary text (muted) on page | 10.83 | 4.5 |
| Dark text #1a1204 on gold button #ecbc52 | 10.49 | 4.5 |

All pass. The feathers fade towards their tips (down to about 40% opacity); they're decoration, not something you need to read, so the faded ends aren't held to 3:1.

## Checks
- **The slate has no visible words, but glyphs never stand alone.** Every glyph SVG is `aria-hidden`. Each cartouche is a `<button>` named "meaning: session" (for example "Waiting on you: Budget sync fix") and `aria-describedby` its own `role="tooltip"`, which holds the plain-English line, time, last action and what it needs from Dan. The tooltip is the visible text label: it shows on hover and on keyboard focus, and it can be hovered itself without disappearing.
- **The slate is a region** ("The slate: sessions and loops") holding an ordered list, newest first and nearest the orb. A new event is also announced through a visually hidden `role="status"` region, since the slate itself is wordless.
- **Summoning.** The orb is a `<button>` ("Astra: show the slate") with `aria-expanded` and `aria-controls="slate"`. Hovering it, focusing it or clicking it opens the slate; so does a new event.
- **Dismissing.** It folds away after 6 seconds with no hover or focus on the orb or the slate, or about half a second after hover or focus leaves the slate (the grace lets you cross back to the orb). It never folds while hovered or focused. Escape folds it from anywhere; if focus was in the slate or on the orb, focus returns to the orb (without that focus re-opening it).
- **Tab order** follows reading order: God mode toggle, orb position, reduce motion, Add a mock event, the orb, the slate's cartouches (straight after the orb, so Tab walks into them), the Eye and sun on her wings, then the satellites. A folded slate is `display: none`, so Tab skips it.
- **Focus** is a 3px turquoise ring on controls and cartouches, and a white ring with a dark halo on the orb, the wing buttons and the satellites.
- **Satellites** are `<button>`s named like "Checkout redesign, working", with a visible tooltip on hover and keyboard focus. Waiting adds an amber ring as well as the colour, and a visible key sits under the orb. The orbit pauses while the pointer or focus is on a satellite.
- **Reduced motion**: `prefers-reduced-motion` or the in-page "Reduce motion" checkbox stops the ring turning, the satellites orbiting, the orb breathing, the dots pulsing, the chisel/glint, and the wing unfolding and folding. The slate and everything else only fade in and out.
- **Toasts** are announced through a `role="status"` region.
- **Sound**: the God mode chime is a short generated tone that always plays on toggle; the toast says the same thing in words.
