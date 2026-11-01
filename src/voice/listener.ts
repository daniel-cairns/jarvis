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

  async start(): Promise<void> {
    if (this.recorder) throw new Error("Already recording");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-audio-"));
    this.wavPath = path.join(dir, "input.wav");
    // 16 kHz mono 16-bit is the format whisper.cpp expects.
    this.recorder = spawn(this.cfg.recorderBin, ["-q", "-r", "16000", "-c", "1", "-b", "16", this.wavPath], {
      stdio: "ignore",
    });
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
