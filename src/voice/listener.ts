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

    // SIGINT lets sox finish writing the WAV header; SIGKILL would leave a broken file.
    await new Promise<void>((resolve) => {
      rec.once("exit", () => resolve());
      rec.kill("SIGINT");
    });

    try {
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
