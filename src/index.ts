import readline from "node:readline";
import { Jarvis } from "./agent.js";
import { loadConfig } from "./config.js";
import { Listener } from "./voice/listener.js";
import { Speaker } from "./voice/speaker.js";

const HELP = `Commands: /new (fresh conversation), /mute, /unmute, /help, /quit. Ctrl-C cancels the current request.`;

/** Hands out stdin lines one at a time to whoever is waiting, in order. */
class LineReader {
  private readonly queue: string[] = [];
  private readonly waiting: ((line: string | null) => void)[] = [];
  private closed = false;

  constructor(private readonly rl: readline.Interface) {
    rl.on("line", (line) => {
      const next = this.waiting.shift();
      if (next) next(line);
      else this.queue.push(line);
    });
    rl.on("close", () => {
      this.closed = true;
      for (const w of this.waiting.splice(0)) w(null);
    });
  }

  next(prompt: string): Promise<string | null> {
    process.stdout.write(prompt);
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiting.push(resolve));
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const textMode = args.has("--text");
  try {
    process.loadEnvFile(".env");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const cfg = loadConfig();

  const speaker = new Speaker(cfg.voice, cfg.speechRate, !args.has("--mute") && process.platform === "darwin");
  let muted = args.has("--mute");
  const listener = new Listener(cfg);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = new LineReader(rl);

  let voiceMode = !textMode;
  if (voiceMode) {
    const problems = await listener.checkSetup();
    if (problems.length) {
      console.log("Voice input isn't ready, so I'll use typed mode:\n  " + problems.join("\n  "));
      voiceMode = false;
    }
  }

  const say = async (text: string) => {
    console.log(`\nJarvis: ${text}\n`);
    if (!muted) await speaker.speak(text);
  };

  /** Empty Enter in voice mode means "listen"; anything typed is used as-is. */
  const getInput = async (prompt: string): Promise<string | null> => {
    const typed = await lines.next(prompt);
    if (typed === null || typed.trim() || !voiceMode) return typed;
    speaker.stop();
    await listener.start();
    const stopped = await lines.next("🎙  Listening... press Enter when you're done. ");
    const heard = await listener.stopAndTranscribe();
    if (stopped === null) return null;
    console.log(heard ? `You: ${heard}` : "(I didn't catch anything)");
    return heard;
  };

  const jarvis = new Jarvis(cfg, {
    say,
    status: (text) => console.log(`  ${text}`),
    ask: async (question) => {
      await say(question);
      return (await getInput(voiceMode ? "[Enter to answer by voice, or type y / a / n] " : "[y / a / n] ")) ?? "no";
    },
  });
  await jarvis.init();

  let busy = false;
  rl.on("SIGINT", () => {
    speaker.stop();
    if (busy && jarvis.cancel()) {
      console.log("\n(cancelling)");
      return;
    }
    rl.close();
  });

  console.log(`Jarvis is ready. ${voiceMode ? "Press Enter to talk, or type a request." : "Type a request."}`);
  console.log(HELP);

  for (;;) {
    const input = await getInput(voiceMode ? "\n[Enter to talk] > " : "\n> ");
    if (input === null) break;
    const request = input.trim();
    if (!request) continue;

    if (request === "/quit" || request === "/exit") break;
    if (request === "/help") { console.log(HELP); continue; }
    if (request === "/new") { jarvis.reset(); console.log("Fresh conversation. Your brain notes are kept."); continue; }
    if (request === "/mute") { muted = true; speaker.stop(); continue; }
    if (request === "/unmute") { muted = false; continue; }

    busy = true;
    try {
      const result = await jarvis.handle(request);
      console.log(`  (${result.ok ? "done" : result.summary} · $${result.costUsd.toFixed(3)})`);
    } catch (err) {
      await say(`That failed: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }

  speaker.stop();
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
