/**
 * Astra's fixed glyph set. Original artwork drawn for this prototype:
 * each glyph is a list of single strokes on a 48×48 grid, so it can be
 * carved stroke by stroke. `label` is the plain-English text that always
 * travels with the glyph.
 */
export const GLYPHS = {
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
    strokes: [
      "M24 44 C24 33 23.5 20 22 8",
      "M22 8 C29 9 32 14 29 21",
      "M23 19 C16 20 14 25 17 30",
      "M18 44 H30",
    ],
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
    strokes: [
      "M24 23 C15 19 16 5 24 5 C32 5 33 19 24 23 Z",
      "M11 25 H37",
      "M24 25 V44",
    ],
  },
  failed: {
    label: "Failed",
    motif: "broken staff",
    strokes: [
      "M12 44 L21 27",
      "M26 20 L34 7 C36 3 41 4 40 9",
      "M19 20 L14 17",
      "M28 27 L33 30",
      "M23 22 L24.5 25",
    ],
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
    strokes: [
      "M4 21 C11 13 19 15 24 24",
      "M24 24 C29 15 37 13 44 21",
      "M24 24 V33",
      "M20 36 L24 33 L28 36",
    ],
  },
  researching: {
    label: "Researching",
    motif: "Thoth's ibis",
    strokes: [
      // Moon disc, then the crescent cradling it.
      "M28 4.5 a4.5 4.5 0 1 0 0.01 0",
      "M20.5 11 C22 18.5 34 18.5 35.5 11",
      // Rounded crown of the ibis head.
      "M35 28 a7 6 0 1 1 -14 0 a7 6 0 1 1 14 0",
      // The long beak curving down to the viewer's left.
      "M21.5 26 C14 28 9 34 7 44 C12 36 16 32.5 22 31",
      // Eye.
      "M27 25.3 a1.2 1.2 0 1 0 0.01 0",
      "M28 34 V44",
    ],
  },
  sun: {
    label: "Sun",
    motif: "sun disc",
    strokes: [
      "M24 15 a9 9 0 1 0 0.01 0",
      "M24 4 V9", "M24 39 V44", "M4 24 H9", "M39 24 H44",
      "M10 10 L13.5 13.5", "M34.5 34.5 L38 38", "M38 10 L34.5 13.5", "M13.5 34.5 L10 38",
    ],
  },
};

/** Satellite colour key for the orb's commanded sessions. */
export const SATELLITE_STATES = ["working", "idle", "waiting"];
