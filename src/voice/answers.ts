/** Understanding spoken answers: approvals ("yeah, go ahead") and choices ("the second one", "Spotify and YouTube"). */
import type { Answer } from "../permissions.js";

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Reads a spoken yes / always / no. Returns null when it isn't clearly any of them, so the caller can ask again. */
export function parseVoiceApproval(raw: string): Answer | null {
  const s = normalise(raw);
  if (!s) return null;
  if (/\b(always|every time|don't ask( me)? again|stop asking)\b/.test(s)) return "always";
  if (/^(no|nope|nah|don't|do not|never|stop|cancel|not now|deny|decline)\b/.test(s)) return "no";
  if (/^(yes|yeah|yep|yup|sure|ok|okay|go|go ahead|do it|please|approve|allow|fine|alright|all right|absolutely|of course)\b/.test(s)) return "yes";
  return null;
}

export type Choice = { label: string; description?: string };

/** One question Astra asks with ask_user. */
export type QuestionSpec = { question: string; options: Choice[]; multiSelect: boolean; allowOther: boolean };
/** Chosen option labels, or free text. */
export type QuestionAnswer = string[] | string;

/** Reads a typed answer: option numbers ("2" or "1, 3"), an option's name, or free text when that's allowed. */
export function parseTypedChoice(raw: string, spec: QuestionSpec): QuestionAnswer | null {
  const text = raw.trim();
  if (!text) return null;
  if (spec.options.length && /^\d+(\s*,\s*\d+)*$/.test(text)) {
    const picks = text.split(",").map((n) => spec.options[Number(n.trim()) - 1]?.label).filter((l): l is string => !!l);
    if (picks.length) return spec.multiSelect ? picks : picks.slice(0, 1);
  }
  return parseSpokenChoice(text, spec);
}

/** Reads a spoken (or typed, non-numeric) answer against a question's options. */
export function parseSpokenChoice(raw: string, spec: QuestionSpec): QuestionAnswer | null {
  const text = raw.trim();
  if (!text) return null;
  if (!spec.options.length) return text;
  return matchChoices(text, spec.options, spec.multiSelect) ?? (spec.allowOther ? text : null);
}

/** Words that don't tell options apart. */
const FILLER_WORDS = new Set(["the", "and", "for", "with", "this", "that", "then", "into", "from", "your", "you", "but"]);

const ORDINALS: Record<string, number> = {
  first: 1, one: 1, "1": 1, second: 2, two: 2, "2": 2, third: 3, three: 3, "3": 3, fourth: 4, four: 4, "4": 4,
  fifth: 5, five: 5, "5": 5, sixth: 6, six: 6, "6": 6,
};

/**
 * Matches a spoken answer to options: by position ("the second one", "number three", "the last one"), by name
 * ("Spotify", "apple music"), or "all"/"both" for multi-select. Returns the chosen labels, or null if nothing matched.
 */
export function matchChoices(raw: string, options: Choice[], multiSelect = false): string[] | null {
  const s = normalise(raw);
  if (!s || !options.length) return null;
  const picked = new Set<number>();
  if (multiSelect && /\b(all|all of them|everything|every one|both)\b/.test(s)) options.forEach((_, i) => picked.add(i));
  if (/\b(last|final)\b/.test(s)) picked.add(options.length - 1);
  for (const word of s.split(" ")) {
    const n = ORDINALS[word];
    if (n && n <= options.length && /\b(first|second|third|fourth|fifth|sixth|last|number|option|one|two|three|four|five|six|\d)\b/.test(s)) {
      // A bare "one" in "that one" isn't a position; only count number words that stand alone or follow number/option.
      if (word === "one" && !/\b(number|option) one\b|^one$/.test(s)) continue;
      picked.add(n - 1);
    }
  }
  // By name: the whole label, or a clear part of it ("send both" for "Send both to Jarvis"). Each option scores the
  // share of its meaningful words that were said; the best scorer wins if it got at least half and no other option
  // tied with it. (The old rule wanted every word and counted "to" as missing, so most labels could never match.)
  if (!picked.size) {
    const said = new Set(s.split(" "));
    const scores = options.map((o) => {
      const label = normalise(o.label);
      if (label && s.includes(label)) return 1;
      const key = label.split(" ").filter((w) => w.length > 2 && !FILLER_WORDS.has(w));
      return key.length ? key.filter((w) => said.has(w)).length / key.length : 0;
    });
    const best = Math.max(...scores);
    const winners = scores.flatMap((score, i) => (score === best ? [i] : []));
    if (best >= 0.5) {
      if (multiSelect) winners.forEach((i) => picked.add(i));
      else if (winners.length === 1) picked.add(winners[0]!);
    }
  }
  if (!picked.size) return null;
  const labels = [...picked].sort((a, b) => a - b).map((i) => options[i]!.label);
  return multiSelect ? labels : labels.slice(0, 1);
}

/** How a question sounds aloud: the question, then the options if there are few enough to list. */
export function speakQuestion(question: string, options: Choice[]): string {
  if (!options.length) return question;
  if (options.length > 5) return `${question} The options are on screen.`;
  const labels = options.map((o) => o.label);
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1)}`;
  return `${question} ${list}?`;
}
