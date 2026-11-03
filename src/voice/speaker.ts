import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodeWav16, loudnessEnvelope, type Pcm } from "./audio.js";
import { chunkForSpeech, toSpeakable } from "./speechText.js";
import type { Tts } from "./tts.js";

export const ENVELOPE_FRAME_MS = 1000 / 60;

/** One sentence as it starts playing, with its loudness per frame so a visual can pulse in step. */
export type Utterance = { text: string; envelope: number[]; frameMs: number };

export type SpeakerEvents = {
  onUtterance?(u: Utterance): void;
  onSpeaking?(speaking: boolean): void;
  /** The primary engine failed and the fallback took over for the rest of the session. */
  onFallback?(from: string, to: string, err: Error): void;
};

export type Player = (wavPath: string) => ChildProcess;

const afplay: Player = (wavPath) => spawn("afplay", [wavPath], { stdio: "ignore" });

/**
 * Speaks one sentence at a time from a queue: nothing overlaps and nothing cuts in except stop(). Within a reply the
 * next sentence renders while the current one plays.
 */
export class Speaker {
  private player: ChildProcess | null = null;
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private speakingNow = false;
  /** 0..1, applied to each sentence as it's played; the next sentence picks up a change. */
  volume = 1;
  private tts: Tts;

  constructor(
    primary: Tts,
    private readonly fallback: Tts | null,
    private readonly enabled: boolean = process.platform === "darwin",
    private readonly events: SpeakerEvents = {},
    private readonly play: Player = afplay,
  ) {
    this.tts = primary;
  }

  /** Loads the voice ahead of the first sentence, switching to the fallback if it can't. */
  async warmUp(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.tts.warmUp();
    } catch (err) {
      this.switchToFallback(err as Error);
    }
  }

  /**
   * Queues text to be spoken after anything already queued, so lines never overlap or cut each other off.
   * Resolves when this text has been spoken (or dropped by stop()).
   */
  speak(markdown: string, opts: { onStart?: () => void } = {}): Promise<void> {
    const chunks = this.enabled ? chunkForSpeech(toSpeakable(markdown)) : [];
    if (!chunks.length) {
      // Nothing to say (or speech is off): whatever was waiting on these words still happens, in its place.
      if (opts.onStart) this.cue(opts.onStart);
      return Promise.resolve();
    }
    const gen = this.generation;
    this.pending++;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      try {
        opts.onStart?.();
      } catch {
        // A visual that fails mustn't stop her talking.
      }
    };
    const run = this.tail.then(() => this.speakChunks(chunks, gen, start)).finally(() => {
      // Stopped before it began: the visual tied to it still appears.
      start();
      this.pending--;
      if (this.pending === 0 && this.speakingNow) {
        this.speakingNow = false;
        this.events.onSpeaking?.(false);
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }

  /**
   * Runs `fn` when everything queued before it has been spoken: a panel opening in its place in what she's saying,
   * rather than whenever its tool happened to run. Immediate when nothing is queued or speech is off; a stop()
   * doesn't drop it.
   */
  cue(fn: () => void): void {
    const run = () => {
      try {
        fn();
      } catch {
        // A visual that fails mustn't stop the queue.
      }
    };
    if (!this.enabled || this.pending === 0) return run();
    this.tail = this.tail.then(run, run);
  }

  /** Resolves once everything queued has been spoken. */
  whenIdle(): Promise<void> {
    return this.tail;
  }

  get busy(): boolean {
    return this.pending > 0;
  }

  /** Stops the current line and drops everything queued. */
  stop(): void {
    this.generation++;
    this.player?.kill("SIGTERM");
    this.player = null;
    if (this.speakingNow) {
      this.speakingNow = false;
      this.events.onSpeaking?.(false);
    }
  }

  private async speakChunks(chunks: string[], gen: number, onStart?: () => void): Promise<void> {
    if (gen !== this.generation) return;
    let next = this.render(chunks[0]!);
    for (let i = 0; i < chunks.length; i++) {
      const pcm = await next;
      if (gen !== this.generation) return;
      if (i + 1 < chunks.length) next = this.render(chunks[i + 1]!);
      if (!this.speakingNow) {
        this.speakingNow = true;
        this.events.onSpeaking?.(true);
      }
      // The moment the first sentence starts playing (rendered, so nothing waits on the voice model after this).
      if (i === 0) onStart?.();
      if (pcm) await this.playOne(chunks[i]!, pcm, gen);
      if (gen !== this.generation) return;
    }
  }

  /** Never rejects: a failed sentence is skipped rather than ending the reply. */
  private async render(text: string): Promise<Pcm | null> {
    try {
      return await this.tts.render(text);
    } catch (err) {
      if (!this.switchToFallback(err as Error)) return null;
      try {
        return await this.tts.render(text);
      } catch {
        return null;
      }
    }
  }

  private switchToFallback(err: Error): boolean {
    if (!this.fallback || this.tts === this.fallback) return false;
    this.events.onFallback?.(this.tts.name, this.fallback.name, err);
    this.tts = this.fallback;
    return true;
  }

  private async playOne(text: string, pcm: Pcm, gen: number): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-voice-"));
    const wav = path.join(dir, "line.wav");
    try {
      const samples = this.volume === 1 ? pcm.samples : pcm.samples.map((s) => s * this.volume);
      await fs.writeFile(wav, encodeWav16({ samples, rate: pcm.rate }));
      // Checked again after the file write: a stop() during it must not let this line start playing anyway.
      if (gen !== this.generation) return;
      await new Promise<void>((resolve) => {
        const child = this.play(wav);
        this.player = child;
        this.events.onUtterance?.({ text, envelope: loudnessEnvelope(pcm, ENVELOPE_FRAME_MS), frameMs: ENVELOPE_FRAME_MS });
        const done = () => {
          if (this.player === child) this.player = null;
          resolve();
        };
        child.on("exit", done);
        child.on("error", done);
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
