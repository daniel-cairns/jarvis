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

export type ListenerConfig = { recorderBin: string; whisperBin: string; whisperModel: string };

/** whisper.cpp prints markers like [BLANK_AUDIO] or (music) for non-speech; those aren't a request. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:music|silence|inaudible|blank audio)[^)]*\)/gi, " ")
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
};

const WAV_HEADER_BYTES = 44;
/** Amplitude below which the mic counts as quiet. Room noise here measured ~0.0003 RMS; speech peaks were ~0.26. */
const QUIET_THRESHOLD = "1%";

/** 16 kHz mono 16-bit is the format whisper.cpp expects; `silence` trims leading quiet and stops after a pause. */
export function recorderArgs(wav: string, opts: ListenOptions = {}): string[] {
  const args = ["-q", "-r", "16000", "-c", "1", "-b", "16", wav];
  if (opts.autoStop) {
    args.push("silence", "1", "0.1", QUIET_THRESHOLD, "1", String(opts.pauseSec ?? 1.5), QUIET_THRESHOLD);
  }
  return args;
}

/** Below this, a recording is a stray double-tap; whisper hallucinates words like "you" from it. */
const MIN_SPEECH_BYTES = 16_000 * 2 * 0.5;

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
    const rec = spawn(this.cfg.recorderBin, recorderArgs(wav, opts), { stdio: "ignore" });
    this.recorder = rec;
    this.done = new Promise((resolve) => rec.once("exit", () => resolve()));
    if (opts.autoStop) this.watchForNoSpeech(rec, wav, opts.noSpeechMs ?? 8_000);
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
      if (size < MIN_SPEECH_BYTES) return "";
      const { stdout } = await execFileAsync(
        this.cfg.whisperBin,
        ["-m", this.cfg.whisperModel, "-f", wav, "-l", "en", "-nt", "-np"],
        { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      );
      return cleanTranscript(stdout);
    } finally {
      await fs.rm(path.dirname(wav), { recursive: true, force: true });
    }
  }
}
