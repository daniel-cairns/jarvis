/**
 * Text-to-speech engines. Each renders a sentence to PCM so the speaker can measure its loudness before playing it.
 * Kokoro is a local neural voice (default); macOS `say` is the fallback when Kokoro can't load.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { decodeWav16, type Pcm } from "./audio.js";

const execFileAsync = promisify(execFile);

export type Tts = {
  readonly name: string;
  render(text: string): Promise<Pcm>;
  /** Loads models ahead of the first sentence; rejects if the engine can't run. */
  warmUp(): Promise<void>;
};

export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

type KokoroModel = { generate(text: string, opts: { voice: string }): Promise<{ audio: Float32Array; sampling_rate: number }> };

export class KokoroTts implements Tts {
  readonly name = "kokoro";
  private model: Promise<KokoroModel> | null = null;

  constructor(
    private readonly voice: string,
    private readonly cacheDir: string,
  ) {}

  warmUp(): Promise<void> {
    return this.load().then(() => undefined);
  }

  async render(text: string): Promise<Pcm> {
    const out = await (await this.load()).generate(text, { voice: this.voice });
    return { samples: out.audio, rate: out.sampling_rate };
  }

  private load(): Promise<KokoroModel> {
    this.model ??= (async () => {
      // Imported lazily: the model stack is heavy, and typed mode with --mute never needs it.
      const { env } = await import("@huggingface/transformers");
      env.cacheDir = this.cacheDir;
      const { KokoroTTS } = await import("kokoro-js");
      return (await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" })) as unknown as KokoroModel;
    })();
    this.model.catch(() => (this.model = null));
    return this.model;
  }
}

export class SayTts implements Tts {
  readonly name = "say";

  constructor(
    private readonly voice: string,
    private readonly rate: number,
  ) {}

  async warmUp(): Promise<void> {
    if (process.platform !== "darwin") throw new Error("say is only available on macOS");
  }

  async render(text: string): Promise<Pcm> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-say-"));
    const file = path.join(dir, "out.wav");
    try {
      // A leading "-" would be parsed as a flag by `say`.
      const safe = text.replace(/^-+\s*/, "");
      await execFileAsync("say", ["-v", this.voice, "-r", String(this.rate), "-o", file,
        "--file-format=WAVE", "--data-format=LEI16@22050", safe]);
      return decodeWav16(await fs.readFile(file));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
