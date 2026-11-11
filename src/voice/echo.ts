/**
 * Telling Astra's own voice apart from Dan's. The microphone stays live while she talks (so "stop" and "Astra, …"
 * can interrupt her), so it hears her too. Whisper, nudged towards her name, can turn a fragment of her own sentence
 * into "Astra's …": "the last teardown" heard from 0.5 s in came back as "Astra's teardown was two days ago", and the
 * rest went in as if Dan had said it. Anything heard that closely matches what she said in the last few seconds is
 * her, not him.
 */

/** How far back her own words count as a possible echo. */
export const ECHO_WINDOW_MS = 20_000;
/** After she stops, sound is still coming out of the speakers and bouncing round the room for a moment. */
export const ECHO_TAIL_MS = 700;

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Same word, or one is the end or start of the other ("down" heard from "teardown", cut off by the recording). */
const sameWord = (a: string, b: string) =>
  a === b || (a.length >= 3 && b.length >= 3 && (a.endsWith(b) || b.endsWith(a) || a.startsWith(b) || b.startsWith(a)));

/** The longest run of consecutive heard words that also comes, in order, in her text. */
function longestRun(heard: string[], hers: string[]): number {
  let best = 0;
  for (let i = 0; i < heard.length; i++) {
    for (let j = 0; j < hers.length; j++) {
      let n = 0;
      while (i + n < heard.length && j + n < hers.length && sameWord(heard[i + n]!, hers[j + n]!)) n++;
      if (n > best) best = n;
    }
  }
  return best;
}

/**
 * Whether a transcript is an echo of her recent speech: most of it (three quarters or more, and at least three
 * words, or all of a short one) is a run of words she has just said. Dan quoting a few of her words inside a
 * longer request of his own still gets through.
 */
export function isEcho(heard: string, recentSpeech: readonly string[]): boolean {
  const h = words(heard);
  if (h.length < 2 || !recentSpeech.length) return false;
  const hers = words(recentSpeech.join(" "));
  const run = longestRun(h, hers);
  return run >= Math.min(3, h.length) && run / h.length >= 0.75;
}

/** Her sentences from the last ECHO_WINDOW_MS. */
export function recentSpeech(spoken: readonly { text: string; at: number }[], now = Date.now()): string[] {
  return spoken.filter((s) => now - s.at <= ECHO_WINDOW_MS).map((s) => s.text);
}
