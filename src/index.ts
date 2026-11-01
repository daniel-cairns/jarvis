import readline from "node:readline";
import { Jarvis } from "./agent.js";
import { loadConfig } from "./config.js";
import { parseAnswer } from "./permissions.js";
import { askDialog } from "./ui/dialog.js";
import { Orb } from "./ui/orb.js";
import { Listener } from "./voice/listener.js";
import { Speaker } from "./voice/speaker.js";
import { KokoroTts, SayTts } from "./voice/tts.js";

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

  /** Queues a line as if it were typed; the orb uses this to stand in for pressing Enter. */
  inject(line: string): void {
    const next = this.waiting.shift();
    if (next) next(line);
    else this.queue.push(line);
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

  let orb: Orb | null = null;
  let listening = false;
  let speaking = false;
  let busy = false;
  const syncOrb = () =>
    orb?.send({ type: "state", state: listening ? "listening" : speaking ? "speaking" : busy ? "thinking" : "idle" });

  const speechEnabled = !args.has("--mute") && process.platform === "darwin";
  const sayTts = new SayTts(cfg.sayVoice, cfg.speechRate);
  const primaryTts = cfg.tts === "kokoro" ? new KokoroTts(cfg.voice, cfg.ttsCacheDir) : sayTts;
  const speaker = new Speaker(primaryTts, primaryTts === sayTts ? null : sayTts, speechEnabled, {
    onUtterance: (u) => orb?.send({ type: "utterance", ...u }),
    onSpeaking: (on) => {
      speaking = on;
      syncOrb();
    },
    onFallback: (from, to, err) => console.log(`  (The ${from} voice isn't available: ${err.message}. Using ${to}.)`),
  });
  void speaker.warmUp();
  let muted = args.has("--mute");
  const listener = new Listener(cfg);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = new LineReader(rl);
  if (!args.has("--no-orb") && process.platform === "darwin") orb = Orb.launch(() => lines.inject(""));

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
    if (muted || !speechEnabled) orb?.send({ type: "caption", role: "jarvis", text });
    else await speaker.speak(text);
  };

  /** Empty Enter in voice mode means "listen"; anything typed is used as-is. */
  let lastInputWasVoice = false;

  /**
   * Empty Enter (or an orb click) in voice mode means "listen"; anything typed is used as-is.
   * Listening ends when you pause, or early on another Enter/click. With listenNow it skips the Enter: that's how
   * Jarvis waits for your reply in a conversation, giving up quietly after a few seconds of silence.
   */
  const getInput = async (prompt: string, signal?: AbortSignal, listenNow = false): Promise<string | null> => {
    lastInputWasVoice = false;
    if (!listenNow || !voiceMode) {
      const typed = await lines.next(prompt, signal);
      if (typed === null || typed.trim() || !voiceMode) return typed;
    }
    speaker.stop();
    await listener.start({ autoStop: true, noSpeechMs: listenNow ? 8_000 : 15_000 });
    listening = true;
    syncOrb();
    const early = new AbortController();
    const how = await Promise.race([
      listener.whenDone().then(() => "paused" as const),
      lines
        .next("🎙  Listening... (I'll stop when you pause; Enter or click the orb to stop now) ",
          signal ? AbortSignal.any([signal, early.signal]) : early.signal)
        .then((line) => (line === null ? ("cancelled" as const) : ("pressed" as const))),
    ]);
    early.abort();
    listening = false;
    syncOrb();
    const heard = await listener.stopAndTranscribe();
    if (how === "cancelled" || signal?.aborted) return null;
    lastInputWasVoice = true;
    if (heard || !listenNow) {
      console.log(heard ? `You: ${heard}` : "(I didn't catch anything)");
      orb?.send({ type: "caption", role: heard ? "you" : "status", text: heard || "I didn't catch anything" });
    }
    return heard;
  };

  const jarvis = new Jarvis(cfg, {
    say,
    status: (text) => {
      console.log(`  ${text}`);
      orb?.send({ type: "caption", role: "status", text: text.replace(/mcp__([^_]+)__/, "$1: ").replace(/_/g, " ") });
    },
    // The orb's card (or the pop-up without it) races the terminal/voice answer; first answer wins.
    ask: async ({ spoken, detail }) => {
      console.log(`\n  Approval needed: ${detail}`);
      const answered = new AbortController();
      const viaVisual = orb?.alive ? orb.ask(spoken, detail, answered.signal) : askDialog(detail, answered.signal);
      void say(spoken);
      const where = orb?.alive ? "the orb" : "the pop-up";
      const prompt = voiceMode ? `[click ${where}, Enter to answer by voice, or type y / a / n] ` : `[click ${where}, or type y / a / n] `;
      const viaInput = getInput(prompt, answered.signal);
      const answer = await Promise.race([viaVisual.then((a) => a ?? viaInput), viaInput.then((a) => a ?? viaVisual)]);
      answered.abort();
      speaker.stop();
      console.log(`  → ${parseAnswer(answer ?? "no")}`);
      return answer ?? "no";
    },
  });
  await jarvis.init();

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

  // After a spoken exchange Jarvis listens for your reply straight away, like a conversation.
  let followUp = false;
  for (;;) {
    const input = await getInput(voiceMode ? "\n[Enter to talk] > " : "\n> ", undefined, followUp);
    followUp = false;
    if (input === null) break;
    const request = input.trim();
    if (!request) continue;

    if (request === "/quit" || request === "/exit") break;
    if (request === "/help") { console.log(HELP); continue; }
    if (request === "/new") { jarvis.reset(); console.log("Fresh conversation. Your brain notes are kept."); continue; }
    if (request === "/mute") { muted = true; speaker.stop(); continue; }
    if (request === "/unmute") { muted = false; continue; }

    busy = true;
    syncOrb();
    try {
      const spoken = lastInputWasVoice;
      const result = await jarvis.handle(request);
      console.log(`  (${result.ok ? "done" : result.summary} · $${result.costUsd.toFixed(3)})`);
      followUp = spoken && result.ok && !muted;
    } catch (err) {
      await say(`That failed: ${(err as Error).message}`);
    } finally {
      busy = false;
      syncOrb();
    }
  }

  speaker.stop();
  orb?.close();
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
