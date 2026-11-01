import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { describeActivity } from "./activity.js";
import { Jarvis } from "./agent.js";
import { loadConfig } from "./config.js";
import { parseAnswer } from "./permissions.js";
import { renderDetail } from "./ui/detail.js";
import { graphAsText } from "./ui/graph.js";
import { stopServing } from "./tools/serve.js";
import { askDialog } from "./ui/dialog.js";
import { Orb } from "./ui/orb.js";
import { Listener } from "./voice/listener.js";
import { Speaker } from "./voice/speaker.js";
import { KokoroTts, SayTts } from "./voice/tts.js";
import { matchWake, speechHint } from "./voice/wake.js";

const HELP = `Say "Astra" to wake her. Commands: /new (fresh conversation), /mute, /unmute, /wake on|off, /help, /quit. Ctrl-C or Esc on the orb stops her.`;
const STOP_WORDS = /^(stop|cancel|never ?mind|be quiet|quiet|shush|shut up)\b/i;

/** A soft acknowledgement when the wake word is heard. */
const chime = () => spawn("afplay", ["/System/Library/Sounds/Tink.aiff"], { stdio: "ignore" }).on("error", () => {});

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

  get isClosed(): boolean {
    return this.closed;
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
  // Both listeners share this config, so refreshing the hint (project names in the workspace) updates both.
  const listenCfg = { ...cfg, hint: speechHint([]) };
  const refreshHint = () => {
    try {
      const projects = readdirSync(cfg.workspaceDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
      listenCfg.hint = speechHint(projects);
    } catch {
      // No workspace yet: keep the default hint.
    }
  };
  const listener = new Listener(listenCfg);
  const wakeListener = new Listener(listenCfg);
  let wakeOn = cfg.wakeWord;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = new LineReader(rl);
  let asking = false;
  let currentAsk: AbortController | null = null;
  let currentListen: AbortController | null = null;

  /** Stops speech, listening, a pending approval and the request in progress. Returns whether anything was running. */
  const interrupt = (): boolean => {
    const active = speaking || listening || busy;
    speaker.stop();
    currentListen?.abort();
    currentAsk?.abort();
    if (busy) jarvis.cancel();
    return active;
  };

  if (!args.has("--no-orb") && process.platform === "darwin") {
    orb = Orb.launch({
      // Clicking the core: answers an approval by voice, ends listening, or barges in on speech/work to listen.
      onTalk: () => {
        if (!asking && !listening && (speaking || busy)) interrupt();
        lines.inject("");
      },
      // "Quit Astra" from the menu bar: stop whatever is running, then leave the main loop.
      onQuit: () => {
        interrupt();
        lines.inject("/quit");
      },
      onStop: () => {
        if (interrupt()) {
          console.log("\n(stopped)");
          orb?.send({ type: "caption", role: "status", text: "Stopped" });
        }
      },
    });
  }

  let voiceMode = !textMode;
  if (voiceMode) {
    const problems = await listener.checkSetup();
    if (problems.length) {
      console.log("Voice input isn't ready, so I'll use typed mode:\n  " + problems.join("\n  "));
      voiceMode = false;
    }
  }

  const say = async (text: string) => {
    console.log(`\nAstra: ${text}\n`);
    if (muted || !speechEnabled) orb?.send({ type: "caption", role: "jarvis", text });
    else await speaker.speak(text);
  };

  /** Empty Enter in voice mode means "listen"; anything typed is used as-is. */
  let lastInputWasVoice = false;

  /**
   * Listens in the background for "Astra …" while idle: sox only records once someone speaks, and each phrase is
   * transcribed and dropped unless it starts with the wake word. Resolves with what followed the name ("" for the
   * name alone), or null if stopped.
   */
  const waitForWake = async (signal: AbortSignal): Promise<string | null> => {
    const onAbort = () => void wakeListener.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal.aborted) {
        // Don't wake on her own voice.
        while (speaking && !signal.aborted) await sleep(150);
        if (signal.aborted) break;
        refreshHint();
        await wakeListener.start({ autoStop: true, pauseSec: 1.4, noSpeechMs: Infinity, maxMs: 20_000 });
        if (signal.aborted) {
          await wakeListener.cancel();
          break;
        }
        await wakeListener.whenDone();
        if (signal.aborted || !wakeListener.recording) break;
        const request = matchWake(await wakeListener.stopAndTranscribe());
        if (request !== null && !signal.aborted) return request;
      }
      return null;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  /** Waits for a typed line, or (in voice mode with the wake word on) for "Astra …", whichever comes first. */
  const nextLineOrWake = async (prompt: string, signal?: AbortSignal): Promise<{ line: string | null } | { wake: string }> => {
    if (!voiceMode || !wakeOn) return { line: await lines.next(prompt, signal) };
    const settled = new AbortController();
    const both = AbortSignal.any([settled.signal, ...(signal ? [signal] : [])]);
    const first = await Promise.race([
      lines.next(prompt, both).then((line) => ({ line })),
      waitForWake(both).then((wake) => (wake === null ? { line: null } : { wake })),
    ]);
    settled.abort();
    return first;
  };

  /**
   * Empty Enter (or an orb click) in voice mode means "listen"; anything typed is used as-is.
   * Listening ends when you pause, or early on another Enter/click. With listenNow it skips the Enter: that's how
   * Astra waits for your reply in a conversation, giving up quietly after a few seconds of silence.
   */
  const getInput = async (prompt: string, signal?: AbortSignal, listenNow = false): Promise<string | null> => {
    lastInputWasVoice = false;
    if (!listenNow || !voiceMode) {
      const got = await nextLineOrWake(prompt, signal);
      if ("wake" in got) {
        chime();
        if (STOP_WORDS.test(got.wake)) {
          interrupt();
          return "";
        }
        if (got.wake) {
          lastInputWasVoice = true;
          console.log(`\nYou: ${got.wake}`);
          orb?.send({ type: "caption", role: "you", text: got.wake });
          return got.wake;
        }
        // The name on its own: listen for the request.
      } else if (got.line === null || got.line.trim() || !voiceMode) {
        return got.line;
      }
    }
    refreshHint();
    speaker.stop();
    await listener.start({ autoStop: true, noSpeechMs: listenNow ? 8_000 : 15_000 });
    listening = true;
    syncOrb();
    const early = new AbortController();
    const stopped = new AbortController();
    currentListen = stopped;
    const how = await Promise.race([
      listener.whenDone().then(() => "paused" as const),
      lines
        .next("🎙  Listening... (I'll stop when you pause; Enter or click the orb to stop now) ",
          AbortSignal.any([early.signal, stopped.signal, ...(signal ? [signal] : [])]))
        .then((line) => (line === null ? ("cancelled" as const) : ("pressed" as const))),
    ]);
    early.abort();
    currentListen = null;
    listening = false;
    syncOrb();
    // "Astra, open Quire" heard while already listening: the name isn't part of the request.
    const raw = await listener.stopAndTranscribe();
    const heard = matchWake(raw) ?? raw;
    if (lines.isClosed || signal?.aborted) return null;
    // Stopped from the orb or Ctrl-C: throw the recording away rather than send it.
    if (how === "cancelled" || stopped.signal.aborted) return "";
    lastInputWasVoice = true;
    if (heard || !listenNow) {
      console.log(heard ? `You: ${heard}` : "(I didn't catch anything)");
      orb?.send({ type: "caption", role: heard ? "you" : "status", text: heard || "I didn't catch anything" });
    }
    return heard;
  };

  const jarvis = new Jarvis(cfg, {
    say,
    graph: (title, graph) => {
      if (orb?.alive) {
        orb.send({ type: "graph", title, graph });
        return "Shown as a 3D map. The user can orbit it and click nodes for detail.";
      }
      console.log(`\n${graphAsText(title, graph)}\n`);
      return "Printed as text in the terminal (no orb is open).";
    },
    show: (title, markdown) => {
      if (orb?.alive) {
        orb.send({ type: "detail", title, html: renderDetail(markdown) });
        return "Shown in the detail panel.";
      }
      console.log(`\n── ${title} ──\n${markdown}\n`);
      return "Printed in the terminal (no orb is open).";
    },
    // The terminal gets the technical line; the orb gets plain English ("Searching your brain…").
    status: (text) => {
      console.log(`  ${text}`);
      const tool = text.match(/^→ (\S+)/)?.[1];
      const friendly = tool ? describeActivity(tool) : text === "… thinking" ? "Thinking…" : text;
      orb?.send({ type: "caption", role: "status", text: friendly });
    },
    // The orb's card (or the pop-up without it) races the terminal/voice answer; first answer wins.
    ask: async ({ spoken, detail }) => {
      console.log(`\n  Approval needed: ${detail}`);
      const answered = new AbortController();
      asking = true;
      currentAsk = answered;
      const viaVisual = orb?.alive ? orb.ask(spoken, detail, answered.signal) : askDialog(detail, answered.signal);
      void say(spoken);
      const where = orb?.alive ? "the orb" : "the pop-up";
      const prompt = voiceMode ? `[click ${where}, Enter to answer by voice, or type y / a / n] ` : `[click ${where}, or type y / a / n] `;
      const viaInput = getInput(prompt, answered.signal);
      const answer = await Promise.race([viaVisual.then((a) => a ?? viaInput), viaInput.then((a) => a ?? viaVisual)]);
      answered.abort();
      asking = false;
      currentAsk = null;
      speaker.stop();
      console.log(`  → ${parseAnswer(answer ?? "no")}`);
      return answer ?? "no";
    },
  });
  await jarvis.init();

  rl.on("SIGINT", () => {
    if (interrupt()) {
      console.log("\n(stopped)");
      return;
    }
    rl.close();
  });

  const howToTalk = wakeOn ? 'Say "Astra", press Enter, or click the orb to talk.' : "Press Enter or click the orb to talk.";
  console.log(`Astra is ready. ${voiceMode ? `${howToTalk} Or type a request.` : "Type a request."}`);
  console.log(HELP);

  // After a spoken exchange Astra listens for your reply straight away, like a conversation.
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
    if (request === "/wake off" || request === "/wake on") {
      wakeOn = request === "/wake on";
      console.log(wakeOn ? 'Say "Astra" to wake me.' : "Wake word off: press Enter or click the orb to talk.");
      continue;
    }

    busy = true;
    syncOrb();
    orb?.send({ type: "caption", role: "status", text: "Thinking…" });
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
  stopServing();
  rl.close();
  // Let Node exit on its own: process.exit() while the voice model's native threads are alive aborts with
  // "mutex lock failed". If anything still holds the process open after 3 s, end it hard.
  setTimeout(() => process.kill(process.pid, "SIGKILL"), 3_000).unref();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
  setTimeout(() => process.kill(process.pid, "SIGKILL"), 3_000).unref();
});
