import readline from "node:readline";
import { Jarvis } from "./agent.js";
import { loadConfig } from "./config.js";
import { parseAnswer } from "./permissions.js";
import { askDialog } from "./ui/dialog.js";
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

  /** Resolves with the next line, or null if stdin closes or `signal` aborts first (the line is then left for the next reader). */
  next(prompt: string, signal?: AbortSignal): Promise<string | null> {
    process.stdout.write(prompt);
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = (line: string | null) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(line);
      };
      const onAbort = () => {
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) this.waiting.splice(i, 1);
        process.stdout.write("\n");
        resolve(null);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
    });
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
  const getInput = async (prompt: string, signal?: AbortSignal): Promise<string | null> => {
    const typed = await lines.next(prompt, signal);
    if (typed === null || typed.trim() || !voiceMode) return typed;
    speaker.stop();
    await listener.start();
    const stopped = await lines.next("🎙  Listening... press Enter when you're done. ", signal);
    const heard = await listener.stopAndTranscribe();
    if (stopped === null) return null;
    console.log(heard ? `You: ${heard}` : "(I didn't catch anything)");
    return heard;
  };

  const jarvis = new Jarvis(cfg, {
    say,
    status: (text) => console.log(`  ${text}`),
    // The pop-up and the terminal/voice answer race; whichever comes first wins and the other is withdrawn.
    ask: async ({ spoken, detail }) => {
      console.log(`\n  Approval needed: ${detail}`);
      const answered = new AbortController();
      const viaDialog = askDialog(detail, answered.signal);
      void say(spoken);
      const prompt = voiceMode ? "[click the pop-up, Enter to answer by voice, or type y / a / n] " : "[click the pop-up, or type y / a / n] ";
      const viaInput = getInput(prompt, answered.signal);
      const answer = await Promise.race([viaDialog.then((a) => a ?? viaInput), viaInput.then((a) => a ?? viaDialog)]);
      answered.abort();
      speaker.stop();
      console.log(`  → ${parseAnswer(answer ?? "no")}`);
      return answer ?? "no";
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
