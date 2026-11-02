/**
 * Push-to-talk speech input: record with sox's `rec`, transcribe locally with whisper.cpp.
 * Audio stays on the machine and the temp file is deleted after transcription.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ListenerConfig = {
  recorderBin: string;
  whisperBin: string;
  whisperModel: string;
  /** A sentence of likely names, so whisper hears "Quire" rather than "choir" (see speechHint). */
  hint?: string;
  /** Longest a recording may run when the caller doesn't set maxMs (JARVIS_MAX_LISTEN_SEC, 45 s by default). */
  maxListenMs?: number;
};

/** whisper.cpp prints markers like [BLANK_AUDIO] or (music) for non-speech; those aren't a request. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    // Sound tags whisper writes for non-speech: "(coughing)", "(indistinct chatter)", "*sighs*".
    .replace(/\([a-z][a-z ,'-]*\)/gi, " ")
    .replace(/\*[a-z][a-z ,'-]*\*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ListenOptions = {
  /** End the recording when the speaker pauses, instead of waiting for a second press. */
  autoStop?: boolean;
  /** Seconds of quiet that count as "finished talking". */
  pauseSec?: number;
  /** Give up if no speech starts within this long. */
  noSpeechMs?: number;
  /** Stop recording after this long regardless. */
  maxMs?: number;
  /** Boost applied (with a limiter) before speech detection, for quiet mics. 0 = none. */
  gainDb?: number;
  /** Loudness (percent of full scale) below which the mic counts as quiet; set from the room by calibration. */
  quietPercent?: number;
};

const WAV_HEADER_BYTES = 44;
/**
 * Level below which the mic counts as quiet, never lower than 1%: at 0.6% everyday room noise kept resetting the
 * end-of-speech timer (recordings ran ~6 s past the last word). Quiet voices at a low mic input level need
 * JARVIS_MIC_GAIN_DB instead. In a noisier room (fan, TV, music) the threshold is raised above the room's own noise,
 * or the pause after you finish never registers.
 */
const QUIET_FLOOR = 1;
/** Steady noise sits this far below the stop threshold (×2.5 ≈ 8 dB), so the room's hum reads as quiet. */
const NOISE_MARGIN = 2.5;
/** Never above this: a threshold too high would hear quiet speech as silence and cut you off. */
const QUIET_CEILING = 8;
const DEFAULT_MAX_LISTEN_MS = 45_000;

/**
 * The room's noise floor from a short 16-bit mono sample, as a fraction of full scale: the RMS of the quietest 30 ms
 * slices (20th percentile), so someone already talking in the sample barely moves it while a steady fan or TV does.
 * Slices of near-total silence are skipped: a Mac mic hands over a blank stretch while it warms up, and counting it
 * read every room as silent.
 */
export function noiseFloor(samples: Int16Array, rate = 16_000): number {
  const size = Math.round(rate * 0.03);
  const slices: number[] = [];
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0;
    for (let j = i; j < i + size; j++) sum += samples[j]! * samples[j]!;
    const rms = Math.sqrt(sum / size) / 32_768;
    if (rms > 0.0001) slices.push(rms);
  }
  if (!slices.length) return 0;
  slices.sort((a, b) => a - b);
  return slices[Math.floor((slices.length - 1) * 0.2)]!;
}

/** The stop threshold for a room: a margin above its noise floor, between 1% and 8%. */
export function quietPercentFor(floor: number): number {
  return Math.min(QUIET_CEILING, Math.max(QUIET_FLOOR, floor * 100 * NOISE_MARGIN));
}

/** 16 kHz mono 16-bit is the format whisper.cpp expects; `silence` trims leading quiet and stops after a pause. */
export function recorderArgs(wav: string, opts: ListenOptions = {}): string[] {
  const args = ["-q", "-r", "16000", "-c", "1", "-b", "16", wav];
  // Gain comes first in the effect chain so speech detection hears the boosted signal; -l limits it to avoid clipping.
  if (opts.gainDb) args.push("gain", "-l", String(opts.gainDb));
  if (opts.autoStop) {
    // Always write the pause with decimals: sox reads a bare "2" as 2 *samples*, which cut every recording off at the
    // first gap between words.
    const pause = (opts.pauseSec ?? 1.5).toFixed(2);
    const quiet = `${Number((opts.quietPercent ?? QUIET_FLOOR).toFixed(2))}%`;
    args.push("silence", "1", "0.10", quiet, "1", pause, quiet);
  }
  return args;
}

/**
 * The shortest recording worth transcribing. Untrimmed push-to-talk: half a second, below which it's a stray
 * double-tap (whisper hallucinates "you" from those). Silence-trimmed recordings are already just speech, and a quick
 * "no" is about 0.4 s of it, so they only need 0.15 s; the half-second guard used to drop short spoken answers.
 */
export function minSpeechBytes(autoStop: boolean): number {
  return Math.round(16_000 * 2 * (autoStop ? 0.15 : 0.5));
}

/**
 * Asks a recorder to stop with SIGINT so it can finalise the WAV, escalating to SIGTERM then SIGKILL.
 * A SIGINT that lands while macOS is still showing the microphone prompt is lost, which would otherwise hang forever.
 */
export function stopGracefully(child: ChildProcess, graceMs = 2_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timers: NodeJS.Timeout[] = [];
    child.once("exit", () => {
      timers.forEach(clearTimeout);
      resolve();
    });
    child.kill("SIGINT");
    timers.push(setTimeout(() => child.kill("SIGTERM"), graceMs));
    timers.push(setTimeout(() => child.kill("SIGKILL"), graceMs * 2));
  });
}

export class Listener {
  private recorder: ChildProcess | null = null;
  private wavPath: string | null = null;
  private done: Promise<void> = Promise.resolve();
  private minBytes = minSpeechBytes(false);
  // The room's noise level, shared by all her recorders. Only the very first recording waits for it; after that a
  // stale reading is used while a fresh one is taken alongside, so recordings start without a gap.
  private static calibrated: { at: number; gainDb: number; quietPercent: number } | null = null;
  private static refreshing = false;
  private static readonly CALIBRATE_MS = 20_000;

  constructor(private readonly cfg: ListenerConfig) {}

  async checkSetup(): Promise<string[]> {
    const problems: string[] = [];
    for (const [bin, hint] of [
      [this.cfg.recorderBin, "brew install sox"],
      [this.cfg.whisperBin, "brew install whisper-cpp"],
    ] as const) {
      try {
        await execFileAsync("which", [bin]);
      } catch {
        problems.push(`"${bin}" not found on PATH (try: ${hint})`);
      }
    }
    try {
      await fs.access(this.cfg.whisperModel);
    } catch {
      problems.push(`Whisper model missing at ${this.cfg.whisperModel} (see README: "Download a speech model")`);
    }
    return problems;
  }

  /**
   * Starts recording. With autoStop, sox ends the recording itself once you pause; if you never start talking,
   * it's stopped after noSpeechMs. `whenDone()` resolves when the recorder exits by itself.
   */
  async start(opts: ListenOptions = {}): Promise<void> {
    if (this.recorder) throw new Error("Already recording");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-audio-"));
    const wav = path.join(dir, "input.wav");
    this.wavPath = wav;
    this.minBytes = minSpeechBytes(!!opts.autoStop);
    // Ending on a pause only works if the pause is quieter than the threshold: set it from the room's own noise.
    if (opts.autoStop && opts.quietPercent === undefined) opts = { ...opts, quietPercent: await this.quietPercent(opts.gainDb ?? 0) };
    const rec = spawn(this.cfg.recorderBin, recorderArgs(wav, opts), { stdio: "ignore" });
    this.recorder = rec;
    this.done = new Promise((resolve) => rec.once("exit", () => resolve()));
    if (opts.autoStop) this.watchForNoSpeech(rec, wav, opts.noSpeechMs ?? 8_000);
    // Always capped, so a pause that never registers can't keep her recording forever.
    const maxMs = opts.maxMs ?? this.cfg.maxListenMs ?? DEFAULT_MAX_LISTEN_MS;
    if (Number.isFinite(maxMs)) {
      const cap = setTimeout(() => void stopGracefully(rec), maxMs);
      rec.once("exit", () => clearTimeout(cap));
    }
  }

  /**
   * The stop threshold for the room, measured with the same gain as the recording (that's what the pause detection
   * hears) and set above the room's noise floor.
   */
  private async quietPercent(gainDb: number): Promise<number> {
    const c = Listener.calibrated;
    if (c && c.gainDb === gainDb) {
      if (Date.now() - c.at >= Listener.CALIBRATE_MS && !Listener.refreshing) {
        Listener.refreshing = true;
        void this.measureRoom(gainDb).finally(() => (Listener.refreshing = false));
      }
      return c.quietPercent;
    }
    return this.measureRoom(gainDb);
  }

  /** Samples the mic for half a second and stores the threshold it gives (1% if it can't be measured). */
  private async measureRoom(gainDb: number): Promise<number> {
    const args = ["-q", "-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", "-t", "raw", "-"];
    if (gainDb) args.push("gain", "-l", String(gainDb));
    // Skips the mic's start-up click and blank stretch, then keeps 0.35 s of the room.
    args.push("trim", "0.15", "0.35");
    const raw = await new Promise<Buffer | null>((resolve) => {
      const chunks: Buffer[] = [];
      const probe = spawn(this.cfg.recorderBin, args, { stdio: ["ignore", "pipe", "ignore"] });
      // The mic permission prompt (or a missing mic) can hold it open: give up after 2 s.
      const timer = setTimeout(() => {
        probe.kill("SIGKILL");
        resolve(null);
      }, 2_000);
      probe.stdout.on("data", (d: Buffer) => chunks.push(d));
      probe.once("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      probe.once("exit", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });
    });
    if (!raw || raw.length < 960) return QUIET_FLOOR;
    const floor = noiseFloor(new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2)));
    const quietPercent = quietPercentFor(floor);
    Listener.calibrated = { at: Date.now(), gainDb, quietPercent };
    if (process.env.JARVIS_DEBUG_WAKE) console.log(`  (room noise ${(floor * 100).toFixed(2)}%, stop below ${quietPercent.toFixed(2)}%)`);
    return quietPercent;
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  /** Stops recording and throws the audio away without transcribing it. */
  async cancel(): Promise<void> {
    const rec = this.recorder;
    const wav = this.wavPath;
    this.recorder = null;
    this.wavPath = null;
    if (rec) await stopGracefully(rec);
    if (wav) await fs.rm(path.dirname(wav), { recursive: true, force: true });
  }

  whenDone(): Promise<void> {
    return this.done;
  }

  /** sox writes nothing until speech starts (the `silence` effect trims it), so a header-only file means no speech yet. */
  private watchForNoSpeech(rec: ChildProcess, wav: string, noSpeechMs: number): void {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (rec.exitCode !== null || rec.signalCode !== null) return clearInterval(timer);
      const size = await fs.stat(wav).then((s) => s.size, () => 0);
      if (size > WAV_HEADER_BYTES) return clearInterval(timer);
      if (Date.now() - startedAt >= noSpeechMs) {
        clearInterval(timer);
        void stopGracefully(rec);
      }
    }, 250);
  }

  async stopAndTranscribe(): Promise<string> {
    const rec = this.recorder;
    const wav = this.wavPath;
    if (!rec || !wav) throw new Error("Not recording");
    this.recorder = null;
    this.wavPath = null;

    // SIGINT lets sox finish writing the WAV header; SIGKILL is only the last resort.
    await stopGracefully(rec);

    try {
      const size = await fs.stat(wav).then((s) => s.size, () => 0);
      if (size < this.minBytes) return "";
      const { stdout } = await execFileAsync(
        this.cfg.whisperBin,
        ["-m", this.cfg.whisperModel, "-f", wav, "-l", "en", "-nt", "-np", ...(this.cfg.hint ? ["--prompt", this.cfg.hint] : [])],
        { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      );
      return cleanTranscript(stdout);
    } finally {
      await fs.rm(path.dirname(wav), { recursive: true, force: true });
    }
  }
}
