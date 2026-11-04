/**
 * Only Dan's voice: each phrase she hears is turned into a voice embedding (a speaker model's description of how the
 * voice sounds, not what was said) and compared with Dan's voiceprint, the average of the phrases he read when he
 * enrolled. All local: the model runs on the Mac and the voiceprint stays in ~/.jarvis/voiceprint.json.
 *
 * A filter, not a lock: a recording of Dan would pass, and short phrases are judged less surely than long ones.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SPEAKER_MODEL = "Xenova/wavlm-base-plus-sv";
const RATE = 16_000;
/** Shorter than this there's too little voice to judge, and nothing is decided. */
const MIN_SECONDS = 0.4;
/** The model only needs this much; longer phrases are judged on their first few seconds. */
const MAX_SECONDS = 8;

/**
 * The score Dan's voice must reach, by phrase length. Short phrases score lower for everyone, so the bar rises with
 * length. Measured on 13 LibriSpeech speakers, each enrolled from three phrases: the equal-error point (as many of
 * the speaker's own phrases refused as other people's let through) at each length. Error there is about 1 in 10 at
 * one second and about 1 in 100 from three seconds.
 */
export const THRESHOLDS: readonly (readonly [seconds: number, score: number])[] = [
  [0.8, 0.8],
  [1.25, 0.856],
  [2, 0.87],
  [3, 0.925],
  [4, 0.944],
];

/** The bar for a phrase this long, interpolated between the measured points; `adjust` raises or lowers it. */
export function thresholdFor(seconds: number, adjust = 0): number {
  const t = THRESHOLDS;
  if (seconds <= t[0]![0]) return t[0]![1] + adjust;
  for (let i = 1; i < t.length; i++) {
    const [s1, v1] = t[i]!;
    if (seconds <= s1) {
      const [s0, v0] = t[i - 1]!;
      return v0 + ((v1 - v0) * (seconds - s0)) / (s1 - s0) + adjust;
    }
  }
  return t.at(-1)![1] + adjust;
}

export function normalise(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

/** Cosine similarity of two normalised embeddings: 1 is the same voice, exactly. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** The average of several normalised embeddings, normalised again. */
export function meanPrint(embeddings: readonly Float32Array[]): Float32Array {
  const sum = new Float32Array(embeddings[0]!.length);
  for (const e of embeddings) for (let i = 0; i < e.length; i++) sum[i]! += e[i]!;
  return normalise(sum);
}

/** A reading that matches the others less than this is re-recorded before the voiceprint is saved. */
export const WEAK_READING = 0.85;
/**
 * How far under Dan's weakest enrolment reading the bar sits. Enrolment readings are cleaner than everyday speech
 * (read close to the Mac, in a quiet moment): measured on 4 Nov 2026, his readings matched each other at 0.97-0.99
 * while his everyday phrases scored 0.906-0.942 against the same print. So the bar sits a gap below enrolment.
 */
const CALIBRATION_MARGIN = 0.08;
/** The most the bar is ever lowered: below this it would let most voices through. */
const MAX_LOWERING = 0.12;

/**
 * The `adjust` that fits the bar to Dan's microphone and room. The bar (thresholdFor) was measured on clean
 * studio recordings, where the same voice scores higher than through a laptop mic. So the bar for a full phrase is
 * set CALIBRATION_MARGIN under his weakest enrolment reading. Never raised, and never lowered more than MAX_LOWERING.
 */
export function calibratedAdjust(selfScores: readonly number[]): number {
  if (!selfScores.length) return 0;
  const target = Math.min(...selfScores) - CALIBRATION_MARGIN;
  const lowering = Math.min(0, target - thresholdFor(4));
  return Math.round(Math.max(-MAX_LOWERING, lowering) * 1000) / 1000;
}

/** How well each embedding matches the average of the others: a low one is a noisy or misread phrase. */
export function selfScoresOf(embeddings: readonly Float32Array[]): number[] {
  return embeddings.map((e, i) => cosine(meanPrint(embeddings.filter((_, j) => j !== i)), e));
}

/**
 * The enrolment panel: every sentence, the one to read now large and marked, the ones done ticked. `again` marks a
 * sentence being read a second time because the first reading didn't match the others.
 */
export function enrolPanel(current: number | null, done: ReadonlySet<number>, again = false): string {
  const now =
    current === null
      ? "### All read: saving your voice…"
      : `### ${again ? "Once more: read" : "Read"} number ${current + 1} of ${ENROL_SENTENCES.length}\n\n> **${ENROL_SENTENCES[current]}**`;
  const list = ENROL_SENTENCES.map((sentence, i) => `${i + 1}. ${done.has(i) ? "✓ " : i === current ? "▶ " : ""}${sentence}`).join("\n");
  return `${now}\n\nRead in your normal voice, at your usual distance from the Mac. I start listening when I say the number.\n\n${list}`;
}

export type VoiceVerdict = { ok: boolean; score: number; threshold: number; seconds: number };

type VoiceprintFile = { model: string; embedding: number[]; adjust: number; enrolledAt: string; selfScores: number[] };

/** Turns 16 kHz mono audio into a normalised voice embedding. */
export type Embedder = (samples: Float32Array) => Promise<Float32Array>;

/** The speaker model, loaded on first use from `cacheDir` (downloaded there the first time). */
export function wavlmEmbedder(cacheDir: string): Embedder {
  let loaded: Promise<{ embed: Embedder }> | null = null;
  const load = () => {
    loaded ??= (async () => {
      // Imported lazily, like the voice: the model stack is heavy and isn't needed until a voiceprint exists.
      const { AutoProcessor, AutoModel } = await import("@huggingface/transformers");
      // Full precision: the quantised model couldn't tell real speakers apart (equal-error rate 15% against 0%).
      const processor = await AutoProcessor.from_pretrained(SPEAKER_MODEL, { cache_dir: cacheDir });
      const model = await AutoModel.from_pretrained(SPEAKER_MODEL, { dtype: "fp32", cache_dir: cacheDir });
      return {
        embed: async (samples: Float32Array) => {
          const out = (await model(await processor(samples))) as { embeddings: { data: Float32Array } };
          return normalise(out.embeddings.data);
        },
      };
    })();
    loaded.catch(() => (loaded = null));
    return loaded;
  };
  return async (samples) => (await load()).embed(samples);
}

export class VoiceCheck {
  private readonly file: string;
  private print: VoiceprintFile | null | undefined;

  constructor(
    home: string,
    private readonly embed: Embedder,
  ) {
    this.file = path.join(home, "voiceprint.json");
  }

  /** Whether Dan has enrolled; until he has, every voice is listened to. */
  get enrolled(): boolean {
    return this.load() !== null;
  }

  /** Is this Dan? Null when there's no voiceprint yet or the phrase is too short to judge. */
  async verdict(samples: Float32Array): Promise<VoiceVerdict | null> {
    const print = this.load();
    const seconds = samples.length / RATE;
    if (!print || seconds < MIN_SECONDS) return null;
    const score = cosine(print.embedding, await this.embed(samples.subarray(0, MAX_SECONDS * RATE)));
    const threshold = thresholdFor(seconds, print.adjust);
    return { ok: score >= threshold, score, threshold, seconds };
  }

  /** How well each reading matches the others, before anything is saved (see WEAK_READING). */
  async readingScores(clips: readonly Float32Array[]): Promise<number[]> {
    return selfScoresOf(await Promise.all(clips.map((c) => this.embed(c.subarray(0, MAX_SECONDS * RATE)))));
  }

  /**
   * Makes Dan's voiceprint from the phrases he read, fits the bar to his microphone (calibratedAdjust), and saves it.
   * Returns how well each phrase matches the print made from the others, and the adjust chosen.
   */
  async enrol(clips: readonly Float32Array[], now = new Date()): Promise<{ selfScores: number[]; adjust: number }> {
    if (clips.length < 3) throw new Error("Enrolment needs at least three phrases.");
    const embeddings = await Promise.all(clips.map((c) => this.embed(c.subarray(0, MAX_SECONDS * RATE))));
    const selfScores = selfScoresOf(embeddings);
    const adjust = calibratedAdjust(selfScores);
    const file: VoiceprintFile = {
      model: SPEAKER_MODEL,
      embedding: [...meanPrint(embeddings)],
      adjust,
      enrolledAt: now.toISOString(),
      selfScores: selfScores.map((s) => Math.round(s * 1000) / 1000),
    };
    writeFileSync(this.file, `${JSON.stringify(file)}\n`);
    this.print = file;
    return { selfScores, adjust };
  }

  /** Forgets the voiceprint: she listens to everyone again. */
  forget(): void {
    rmSync(this.file, { force: true });
    this.print = null;
  }

  private load(): VoiceprintFile | null {
    if (this.print !== undefined) return this.print;
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as VoiceprintFile;
      this.print = data.model === SPEAKER_MODEL && Array.isArray(data.embedding) ? data : null;
    } catch {
      this.print = null;
    }
    return this.print;
  }
}

/** Sentences for enrolment: varied sounds, about four seconds each, the way Dan talks to her. */
export const ENROL_SENTENCES = [
  "Astra, what's on my plate this afternoon, and is anything urgent?",
  "Open the brain browser and show me yesterday's teardown, please.",
  "Start a background session on Temper and tell me when it's finished.",
  "Check my calendar for Thursday and move the dentist to the morning.",
  "Give me a quick sit rep of every session that's waiting on me.",
] as const;
