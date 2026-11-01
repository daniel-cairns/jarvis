/** Wake word and transcription hints. */

/** How whisper tends to hear "Astra", optionally after "hey"/"ok". */
const WAKE = /^(?:(?:hey|hi|ok|okay)\s+)?(?:astra|astrah|astro|astrid|ashtra|astre|astrae)(?:'s)?\b[\s,.!?:;-]*/i;

/**
 * Returns what was said after the wake word ("" if it was the wake word alone), or null if the phrase
 * didn't start with it. Only the start counts, so "the astra project" said in passing doesn't wake her.
 */
export function matchWake(transcript: string): string | null {
  const text = transcript.trim().replace(/^[\s"'“”‘’.,!?-]+/, "");
  const m = text.match(WAKE);
  if (!m) return null;
  return text.slice(m[0].length).trim();
}

const WAKE_ANYWHERE = /\b(?:astra|astrah|astro|astrid|ashtra|astre|astrae)(?:'s)?\b[\s,.!?:;-]*/gi;

/**
 * For barge-in while Astra is talking: her own voice is in the same recording, so the name may not come first.
 * Finds the last "Astra" anywhere and returns what followed it, unless the sentence she's speaking has her name in
 * it (then it's probably her own voice), in which case it returns null.
 */
export function matchWakeAnywhere(transcript: string, ownSpeech: string): string | null {
  if (/\bastra\b/i.test(ownSpeech)) return null;
  let last: RegExpExecArray | null = null;
  for (const m of transcript.matchAll(WAKE_ANYWHERE)) last = m as RegExpExecArray;
  if (!last) return null;
  return transcript.slice(last.index! + last[0].length).trim();
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/**
 * Cuts her own words out of a request heard while she was talking: whisper hears both voices, so "Astra, run date"
 * can come back as "run date. It's now 1:13 in the morning…". The request is cut where any sentence she spoke during
 * the recording begins (matched on its first three words).
 */
export function stripOwnSpeech(request: string, ownSentences: string[]): string {
  const req = words(request);
  let cut = req.length;
  for (const sentence of ownSentences) {
    const head = words(sentence).slice(0, 3);
    if (head.length < 2) continue;
    for (let i = 0; i + head.length <= req.length; i++) {
      if (head.every((w, j) => req[i + j] === w)) {
        cut = Math.min(cut, i);
        break;
      }
    }
  }
  if (cut === req.length) return request.trim();
  // Map the cut (in words) back onto the original text, keeping its punctuation.
  const tokens = request.trim().split(/\s+/);
  let seen = 0;
  const kept: string[] = [];
  for (const token of tokens) {
    if (words(token).length && seen++ >= cut) break;
    kept.push(token);
  }
  return kept.join(" ").replace(/[\s,;:-]+$/, "").trim();
}

/**
 * A sentence that primes whisper with names it would otherwise mishear ("Quire" → "choir").
 * It must read as a sentence: a bare comma-separated list made whisper return nothing in testing.
 */
export function speechHint(projects: string[]): string {
  const base = "Talking to Astra about REA teardowns and Nuxt apps";
  const names = projects.filter((p) => /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,40}$/u.test(p)).slice(0, 12);
  if (!names.length) return `${base}.`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${base}, and the projects ${list}.`;
}
