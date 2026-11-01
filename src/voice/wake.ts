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
