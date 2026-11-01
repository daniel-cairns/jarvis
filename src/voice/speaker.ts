import { spawn, type ChildProcess } from "node:child_process";
import { chunkForSpeech, toSpeakable } from "./speechText.js";

/** Speaks through the built-in macOS `say` command, one chunk at a time so it can be cut off. */
export class Speaker {
  private current: ChildProcess | null = null;
  private generation = 0;

  constructor(
    private readonly voice: string,
    private readonly rate: number,
    private readonly enabled: boolean = process.platform === "darwin",
  ) {}

  async speak(markdown: string): Promise<void> {
    if (!this.enabled) return;
    const gen = ++this.generation;
    for (const chunk of chunkForSpeech(toSpeakable(markdown))) {
      if (gen !== this.generation) return;
      await this.sayOnce(chunk);
    }
  }

  stop(): void {
    this.generation++;
    this.current?.kill("SIGTERM");
    this.current = null;
  }

  private sayOnce(text: string): Promise<void> {
    return new Promise((resolve) => {
      // A chunk starting with "-" would be parsed as a flag by `say`.
      const safe = text.replace(/^-+\s*/, "");
      const child = spawn("say", ["-v", this.voice, "-r", String(this.rate), safe], { stdio: "ignore" });
      this.current = child;
      const done = () => {
        if (this.current === child) this.current = null;
        resolve();
      };
      child.on("exit", done);
      child.on("error", done);
    });
  }
}
