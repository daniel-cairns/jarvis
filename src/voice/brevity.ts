/**
 * Keeping what Astra says short: a spoken reply is cut to its headline (the rest waits for "more"), and sentences she
 * has said in the last few minutes aren't said again. Her instructions ask for both; these make sure of it.
 */
import { toSpeakable } from "./speechText.js";

/** About two short sentences: past this, the rest of a reply waits until Dan asks for more. */
export const SPOKEN_WORDS = 30;
/** How long a sentence counts as "already said". */
export const REPEAT_WINDOW_MS = 10 * 60_000;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Splits speakable text into sentences (and lines, which a list or heading leaves). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The headline of a reply and what's left: whole sentences while they fit in `maxWords` (always at least one), and
 * everything after them. Both are speakable text (no markdown).
 */
export function headline(markdown: string, maxWords = SPOKEN_WORDS): { spoken: string; rest: string } {
  const all = sentences(toSpeakable(markdown));
  let count = 0;
  let cut = 0;
  while (cut < all.length) {
    const n = words(all[cut]!).length;
    if (cut > 0 && count + n > maxWords) break;
    count += n;
    cut++;
  }
  return { spoken: all.slice(0, cut).join(" "), rest: all.slice(cut).join(" ") };
}

const key = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  );

/** Word overlap (Jaccard) of two sentences: 1 is the same words. */
function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared || 1);
}

/**
 * Drops the sentences she has already said recently (near enough word for word). Short ones ("Done.", "On it.")
 * always stay: repeating those is natural.
 */
export function dropRepeats(text: string, said: readonly { text: string; at: number }[], now = Date.now(), windowMs = REPEAT_WINDOW_MS): string {
  const recent = said.filter((u) => now - u.at <= windowMs).flatMap((u) => sentences(u.text)).map(key);
  return sentences(text)
    .filter((s) => {
      const k = key(s);
      return k.size < 5 || !recent.some((r) => overlap(k, r) >= 0.8);
    })
    .join(" ");
}

/**
 * What "tell me more" reads next: the rest of a long reply, or the detail panel she just opened, in chunks of about
 * `SPOKEN_WORDS` words. Whatever came last replaces what was there.
 */
export class MoreQueue {
  private chunks: string[] = [];

  /** The rest of a reply that was cut to its headline. */
  setRest(rest: string): void {
    this.chunks = chunk(sentences(rest));
  }

  /** A detail panel's markdown: its sections, read in order. */
  setPanel(markdown: string): void {
    this.chunks = chunk(sentences(toSpeakable(markdown).replace(/\(code omitted\)/g, "")));
  }

  get empty(): boolean {
    return this.chunks.length === 0;
  }

  /** The next chunk to say, or null when there's nothing more. */
  next(): string | null {
    return this.chunks.shift() ?? null;
  }

  clear(): void {
    this.chunks = [];
  }
}

function chunk(all: string[], maxWords = SPOKEN_WORDS): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const s of all) {
    const n = words(s).length;
    if (current.length && count + n > maxWords) {
      out.push(current.join(" "));
      current = [];
      count = 0;
    }
    current.push(s);
    count += n;
  }
  if (current.length) out.push(current.join(" "));
  return out;
}
