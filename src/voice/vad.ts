/**
 * Ending a recording when you stop talking, with a speech detector rather than a loudness level. A loudness gate
 * can't tell a fan or music from a voice, so steady noise above it kept her recording; Silero VAD (a small local
 * model, run here through onnxruntime-node) scores each 32 ms of audio for how likely it is to be speech, and a
 * recording ends after about 1.5 s with no speech in it, however loud the room.
 */
import { existsSync } from "node:fs";
import type { Readable } from "node:stream";
import * as ort from "onnxruntime-node";

export const VAD_RATE = 16_000;
/** Silero v5 scores 512 samples (32 ms) at a time, seeing the 64 before them for context. */
export const FRAME_SAMPLES = 512;
const CONTEXT = 64;
export const FRAME_MS = (FRAME_SAMPLES / VAD_RATE) * 1000;

export type SpeechEndOptions = {
  /** Silence after speech that ends the recording ("finished talking"). */
  endSilenceMs?: number;
  /** Speech this long in a row counts as you having started (a click or cough doesn't). */
  startMs?: number;
  /** A frame is speech at or above this probability... */
  onThreshold?: number;
  /** ...and silence only below this one, so a soft syllable in mid-sentence doesn't start the silence clock. */
  offThreshold?: number;
};

/**
 * Decides, frame by frame, whether you've started talking and when you've finished. Pure: give it each frame's speech
 * probability and it says "waiting" (not started), "speech" (talking, or pausing for less than endSilenceMs) or
 * "ended".
 */
export class SpeechEnd {
  private readonly endFrames: number;
  private readonly startFrames: number;
  private readonly on: number;
  private readonly off: number;
  private run = 0;
  private silent = 0;
  started = false;
  ended = false;

  constructor(opts: SpeechEndOptions = {}) {
    this.endFrames = Math.ceil((opts.endSilenceMs ?? 1500) / FRAME_MS);
    this.startFrames = Math.max(1, Math.round((opts.startMs ?? 96) / FRAME_MS));
    this.on = opts.onThreshold ?? 0.5;
    this.off = opts.offThreshold ?? 0.35;
  }

  push(probability: number): "waiting" | "speech" | "ended" {
    if (this.ended) return "ended";
    if (!this.started) {
      this.run = probability >= this.on ? this.run + 1 : 0;
      if (this.run < this.startFrames) return "waiting";
      this.started = true;
      return "speech";
    }
    this.silent = probability < this.off ? this.silent + 1 : 0;
    if (this.silent >= this.endFrames) this.ended = true;
    return this.ended ? "ended" : "speech";
  }
}

/** One stream's view of the shared Silero model: its own running state and context. */
export class SileroVad {
  private state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  private context = new Float32Array(CONTEXT);
  private readonly sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(VAD_RATE)]), []);

  constructor(private readonly session: ort.InferenceSession) {}

  /** The probability (0–1) that this 512-sample frame (floats in −1…1) is speech. */
  async score(frame: Float32Array): Promise<number> {
    const input = new Float32Array(CONTEXT + FRAME_SAMPLES);
    input.set(this.context);
    input.set(frame, CONTEXT);
    this.context = input.slice(-CONTEXT);
    const out = await this.session.run({ input: new ort.Tensor("float32", input, [1, input.length]), state: this.state, sr: this.sr });
    this.state = out.stateN as ort.Tensor;
    return (out.output!.data as Float32Array)[0]!;
  }
}

let loading: Promise<ort.InferenceSession> | null = null;
let loadedFrom = "";

/** Loads the model once (shared by all her recorders). Rejects with a plain reason if it's missing or won't load. */
export function loadVadModel(modelPath: string): Promise<ort.InferenceSession> {
  if (!loading || loadedFrom !== modelPath) {
    loadedFrom = modelPath;
    loading = existsSync(modelPath)
      ? ort.InferenceSession.create(modelPath)
      : Promise.reject(new Error(`no speech detector model at ${modelPath}`));
    loading.catch(() => (loading = null));
  }
  return loading;
}

export type CaptureResult = {
  /** The speech, with a short lead-in from before it started: 16-bit mono PCM at 16 kHz. */
  pcm: Int16Array;
  heardSpeech: boolean;
};

/**
 * Listens to raw 16 kHz mono 16-bit audio as it arrives, scoring every 32 ms frame. Keeps a short lead-in from
 * before you started (so the first syllable isn't clipped) and everything after; calls onEnd once you've finished
 * talking. Frames are scored in order, one at a time.
 */
export class VadCapture {
  private readonly detector: SpeechEnd;
  private readonly leadIn: Float32Array[] = [];
  private readonly kept: Int16Array[] = [];
  private pending = new Int16Array(0);
  private queue: Promise<void> = Promise.resolve();
  private endSignalled = false;

  constructor(
    private readonly vad: SileroVad,
    private readonly onEnd: () => void,
    opts: SpeechEndOptions & { leadInMs?: number } = {},
    private readonly leadInFrames = Math.ceil((opts.leadInMs ?? 400) / FRAME_MS),
  ) {
    this.detector = new SpeechEnd(opts);
  }

  get started(): boolean {
    return this.detector.started;
  }

  /** Reads a stream of raw PCM until it ends. */
  attach(stream: Readable): void {
    stream.on("data", (chunk: Buffer) => this.write(chunk));
  }

  write(chunk: Buffer): void {
    const merged = new Int16Array(this.pending.length + Math.floor(chunk.length / 2));
    merged.set(this.pending);
    merged.set(new Int16Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + (chunk.length & ~1))), this.pending.length);
    let i = 0;
    for (; i + FRAME_SAMPLES <= merged.length; i += FRAME_SAMPLES) {
      const frame = merged.slice(i, i + FRAME_SAMPLES);
      this.queue = this.queue.then(() => this.frame(frame));
    }
    this.pending = merged.slice(i);
  }

  /** Waits for every frame received so far to be scored. */
  settle(): Promise<void> {
    return this.queue;
  }

  result(): CaptureResult {
    const total = this.kept.reduce((n, f) => n + f.length, 0);
    const pcm = new Int16Array(total);
    let at = 0;
    for (const f of this.kept) {
      pcm.set(f, at);
      at += f.length;
    }
    return { pcm, heardSpeech: this.detector.started };
  }

  private async frame(frame: Int16Array): Promise<void> {
    if (this.detector.ended) return;
    const floats = Float32Array.from(frame, (s) => s / 32_768);
    const wasStarted = this.detector.started;
    const verdict = this.detector.push(await this.vad.score(floats));
    if (!wasStarted) {
      // Before you start talking only a short lead-in is kept; it's added in front once you do.
      this.leadIn.push(floats);
      if (this.leadIn.length > this.leadInFrames) this.leadIn.shift();
      if (verdict === "waiting") return;
      for (const f of this.leadIn) this.kept.push(Int16Array.from(f, (x) => Math.round(x * 32_767)));
      return;
    }
    this.kept.push(frame);
    if (verdict === "ended" && !this.endSignalled) {
      this.endSignalled = true;
      this.onEnd();
    }
  }
}
