import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { activityGlyph, describeActivity } from "./activity.js";
import { Jarvis } from "./agent.js";
import { loadConfig } from "./config.js";
import { parseAnswer, type Answer } from "./permissions.js";
import { renderDetail } from "./ui/detail.js";
import { checkGraph, graphAsText, graphShape } from "./ui/graph.js";
import { brainIndex, noteMap, readNote } from "./tools/brain.js";
import { z } from "zod";
import { stopServing } from "./tools/serve.js";
import { quickUiCommand, type UiAction, type UiCommand } from "./ui/control.js";
import { clampVolume, loadSettings, saveSettings } from "./settings.js";
import { askDialog } from "./ui/dialog.js";
import { Orb } from "./ui/orb.js";
import { Listener } from "./voice/listener.js";
import { Speaker } from "./voice/speaker.js";
import { KokoroTts, SayTts } from "./voice/tts.js";
import {
  parseSpokenChoice,
  parseTypedChoice,
  parseVoiceApproval,
  speakQuestion,
  type QuestionAnswer,
} from "./voice/answers.js";
import { matchWake, matchWakeAnywhere, speechHint } from "./voice/wake.js";

const HELP = `Say "Astra" to wake her. Commands: /new (fresh conversation), /mute, /unmute, /wake on|off, /help, /quit. Ctrl-C or Esc on the orb stops her.`;
const STOP_WORDS = /^(stop|cancel|never ?mind|be quiet|quiet|shush|shut up)\b/i;

/** A soft acknowledgement when the wake word is heard. */
const chime = () => spawn("afplay", ["/System/Library/Sounds/Tink.aiff"], { stdio: "ignore" }).on("error", () => {});

/** Resolves with the first promise to give a non-null value; null if they all give null. */
function firstAnswer<T>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let left = promises.length;
    for (const p of promises) {
      p.then(
        (v) => {
          if (v !== null) resolve(v);
          else if (--left === 0) resolve(null);
        },
        () => {
          if (--left === 0) resolve(null);
        },
      );
    }
  });
}

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
  let ownSpeech = "";
  let lastSpokeAt = 0;
  let listening = false;
  let speaking = false;
  let busy = false;
  const syncOrb = () =>
    orb?.send({ type: "state", state: listening ? "listening" : speaking ? "speaking" : busy ? "thinking" : "idle" });

  const speechEnabled = !args.has("--mute") && process.platform === "darwin";
  const sayTts = new SayTts(cfg.sayVoice, cfg.speechRate);
  const primaryTts = cfg.tts === "kokoro" ? new KokoroTts(cfg.voice, cfg.ttsCacheDir) : sayTts;
  const speaker = new Speaker(primaryTts, primaryTts === sayTts ? null : sayTts, speechEnabled, {
    onUtterance: (u) => {
      ownSpeech = u.text;
      lastSpokeAt = Date.now();
      orb?.send({ type: "utterance", ...u });
    },
    onSpeaking: (on) => {
      speaking = on;
      syncOrb();
    },
    onFallback: (from, to, err) => console.log(`  (The ${from} voice isn't available: ${err.message}. Using ${to}.)`),
  });
  void speaker.warmUp();
  const settings = loadSettings(cfg.home);
  speaker.volume = settings.volume;
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
  let quitting = false;
  // While a dialog is open, "Astra …" (or a click on the orb) goes to it instead of starting a new request.
  let dialogWake: ((request: string) => void) | null = null;
  // A request heard via the wake word and queued for the main loop, so it's treated as spoken.
  let wokeWith: string | null = null;

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
        if (dialogWake) return dialogWake("");
        if (!listening && (speaking || busy)) interrupt();
        lines.inject("");
      },
      // "Quit Astra" from the menu bar: stop whatever is running, then leave the main loop.
      onQuit: () => {
        interrupt();
        quitting = true;
        lines.inject("/quit");
      },
      onBrain: (msg) => void onBrain(msg),
      onVolume: (msg) => void setVolume(msg.level ?? settings.volume + (msg.delta ?? 0)),
      onStop: () => {
        if (interrupt()) {
          console.log("\n(stopped)");
          orb?.send({ type: "caption", role: "status", text: "Stopped" });
        }
      },
    });
  }

  orb?.send({ type: "volume-level", level: settings.volume, quiet: true });

  let voiceMode = !textMode;
  if (voiceMode) {
    const problems = await listener.checkSetup();
    if (problems.length) {
      console.log("Voice input isn't ready, so I'll use typed mode:\n  " + problems.join("\n  "));
      voiceMode = false;
    }
  }

  // Queued: lines never overlap (see Speaker). Resolves when this line has been spoken.
  const say = async (text: string) => {
    console.log(`\nAstra: ${text}\n`);
    if (muted || !speechEnabled) orb?.send({ type: "caption", role: "jarvis", text });
    else await speaker.speak(text);
  };

  let lastInputWasVoice = false;

  /**
   * Records one spoken phrase and transcribes it. Ends when you pause or when `earlyStop` resolves (Enter or a click);
   * returns null if `signal` aborts or Astra is stopped. "Astra, …" at the start is stripped.
   */
  const listenOnce = async (noSpeechMs: number, signal?: AbortSignal, earlyStop?: Promise<unknown>): Promise<string | null> => {
    refreshHint();
    await listener.start({ autoStop: true, pauseSec: cfg.pauseSec, gainDb: cfg.micGainDb, noSpeechMs });
    listening = true;
    syncOrb();
    const stopped = new AbortController();
    currentListen = stopped;
    const cancel = AbortSignal.any([stopped.signal, ...(signal ? [signal] : [])]);
    const how = await Promise.race([
      listener.whenDone().then(() => "paused" as const),
      new Promise<"cancelled">((resolve) => {
        if (cancel.aborted) resolve("cancelled");
        cancel.addEventListener("abort", () => resolve("cancelled"), { once: true });
      }),
      ...(earlyStop ? [earlyStop.then(() => "pressed" as const)] : []),
    ]);
    currentListen = null;
    listening = false;
    syncOrb();
    if (how === "cancelled") {
      await listener.cancel();
      return null;
    }
    const raw = await listener.stopAndTranscribe();
    return matchWake(raw) ?? raw;
  };

  /**
   * The wake word, always on in voice mode: while idle, working or talking. Each phrase is transcribed and dropped
   * unless it has her name. While she talks her own voice is in the recording, so the name may come anywhere, but a
   * sentence of hers that contains "Astra" is ignored. Pauses while the main microphone is listening.
   */
  const wakeLoop = async () => {
    while (!quitting) {
      if (!voiceMode || !wakeOn || listening) {
        await sleep(200);
        continue;
      }
      const talking = speaking;
      const startedAt = Date.now();
      refreshHint();
      await wakeListener.start({
        autoStop: true,
        pauseSec: talking ? 0.6 : cfg.pauseSec,
        gainDb: cfg.micGainDb,
        noSpeechMs: Infinity,
        maxMs: talking ? 6_000 : 20_000,
      });
      const watch = setInterval(() => {
        if (listening || !wakeOn || quitting) void wakeListener.cancel();
      }, 150);
      await wakeListener.whenDone();
      clearInterval(watch);
      if (!wakeListener.recording) continue;
      const heard = await wakeListener.stopAndTranscribe();
      // If she spoke at any point during the recording, her voice is in it, so the name may come anywhere.
      const herVoice = talking || speaking || lastSpokeAt >= startedAt;
      const request = herVoice ? matchWakeAnywhere(heard, ownSpeech) : matchWake(heard);
      if (process.env.JARVIS_DEBUG_WAKE) console.log(`  (wake ${herVoice ? "over her voice" : "idle"} heard: "${heard}" → ${request === null ? "ignored" : `"${request}"`})`);
      if (request !== null) onWake(request);
    }
  };

  /** "Astra …" was heard: a quick UI command, an answer to an open dialog, or a request (barging in on her). */
  const onWake = (request: string) => {
    chime();
    if (STOP_WORDS.test(request)) {
      if (interrupt()) {
        console.log("\n(stopped)");
        orb?.send({ type: "caption", role: "status", text: "Stopped" });
      }
      return;
    }
    const quick = quickUiCommand(request);
    if (quick && !dialogWake) {
      console.log(`\n(${quick.action.replace(/_/g, " ")}${quick.level !== undefined ? ` ${quick.level}` : ""})`);
      return void runUi(quick);
    }
    if (dialogWake) return dialogWake(request);
    if (busy || speaking) interrupt();
    if (request) wokeWith = request;
    lines.inject(request);
  };

  /**
   * Waits for a spoken answer to an open dialog. It listens once she has finished talking (no wake word or click
   * needed), tries twice, then waits for "Astra" or a click on the orb to listen again. Unclear answers get a short
   * re-ask. Resolves null when the dialog is answered another way.
   */
  const voiceAnswer = async <T,>(parse: (text: string) => T | null, reAsk: string, signal: AbortSignal): Promise<T | null> => {
    if (!voiceMode) return null;
    let woke: string | null = null;
    let wakeUp: (() => void) | null = null;
    dialogWake = (request) => {
      woke = request;
      wakeUp?.();
    };
    try {
      let tries = 0;
      while (!signal.aborted) {
        await speaker.whenIdle();
        if (signal.aborted) return null;
        let heard: string | null;
        if (woke) {
          heard = woke;
          woke = null;
        } else if (tries < 2 || woke === "") {
          woke = null;
          tries++;
          console.log("  🎙  listening for your answer…");
          heard = await listenOnce(12_000, signal);
        } else {
          await new Promise<void>((resolve) => {
            wakeUp = resolve;
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          wakeUp = null;
          continue;
        }
        if (heard === null) return null;
        if (!heard) continue;
        console.log(`You: ${heard}`);
        orb?.send({ type: "caption", role: "you", text: heard });
        const parsed = parse(heard);
        if (parsed !== null) return parsed;
        void say(reAsk);
      }
      return null;
    } finally {
      dialogWake = null;
    }
  };

  /**
   * The main prompt: a typed line, a request heard via the wake word, or (empty Enter, a click, or "Astra" alone) a
   * spoken request. With listenNow it listens straight away: that's how Astra waits for your reply in a conversation,
   * giving up quietly after a few seconds of silence.
   */
  const getInput = async (prompt: string, signal?: AbortSignal, listenNow = false): Promise<string | null> => {
    lastInputWasVoice = false;
    if (!listenNow || !voiceMode) {
      const typed = await lines.next(prompt, signal);
      if (typed !== null && wokeWith !== null && typed === wokeWith) {
        wokeWith = null;
        lastInputWasVoice = true;
        console.log(`\nYou: ${typed}`);
        orb?.send({ type: "caption", role: "you", text: typed });
        return typed;
      }
      if (typed === null || typed.trim() || !voiceMode) return typed;
    }
    speaker.stop();
    const early = new AbortController();
    const pressed = lines
      .next("🎙  Listening... (I'll stop when you pause; Enter or click the orb to stop now) ",
        AbortSignal.any([early.signal, ...(signal ? [signal] : [])]))
      .then((line) => (line === null ? new Promise<never>(() => {}) : line));
    const heard = await listenOnce(listenNow ? 8_000 : 15_000, signal, pressed);
    early.abort();
    if (lines.isClosed || signal?.aborted) return null;
    if (heard === null) return "";
    lastInputWasVoice = true;
    if (heard || !listenNow) {
      console.log(heard ? `You: ${heard}` : "(I didn't catch anything)");
      orb?.send({ type: "caption", role: heard ? "you" : "status", text: heard || "I didn't catch anything" });
    }
    return heard;
  };

  /** Opens the brain browser (every note and teardown), or lists them in the terminal without the orb. */
  const openBrain = async (): Promise<string> => {
    const notes = await brainIndex(cfg.brainDir);
    if (!orb?.alive) {
      for (const n of notes) console.log(`  ${n.folder}/ ${n.title}`);
      return `Listed ${notes.length} notes in the terminal.`;
    }
    orb.send({ type: "brain", notes });
    return `Opened the brain browser with ${notes.length} notes.`;
  };

  /** The brain browser's requests: the list, one note (rendered), or a note's saved map. */
  const onBrain = async (msg: { type: "brain-request" } | { type: "brain-open" | "brain-map"; path: string }) => {
    try {
      if (msg.type === "brain-request") return void (await openBrain());
      if (msg.type === "brain-open") {
        const note = await readNote(cfg.brainDir, msg.path);
        const hasMap = /```astra-graph/.test(note.text);
        const body = note.text
          .replace(/^---[\s\S]*?---\n/, "")
          .replace(/```astra-graph[\s\S]*?```/g, "*A 3D map is saved with this note: use Show map.*");
        orb?.send({ type: "brain-note", path: msg.path, title: note.title, html: renderDetail(body), hasMap });
        return;
      }
      const raw = await noteMap(cfg.brainDir, msg.path);
      if (!raw) return;
      const graph = checkGraph(z.object(graphShape).parse(raw));
      orb?.send({ type: "graph", title: msg.path.split("/").at(-1)!.replace(/\.md$/, ""), graph });
    } catch (err) {
      console.log(`  (brain browser: ${(err as Error).message})`);
    }
  };

  /** Sets her speaking volume (0–1), remembers it, and shows it on the orb. Takes effect from the next sentence. */
  const setVolume = (volume: number): string => {
    settings.volume = clampVolume(volume);
    speaker.volume = settings.volume;
    saveSettings(cfg.home, settings);
    orb?.send({ type: "volume-level", level: settings.volume });
    return `Volume ${Math.round(settings.volume * 100)}%.`;
  };

  /** Astra working her own interface, by voice or via ui_control. */
  const runUi = async (command: UiCommand | UiAction): Promise<string> => {
    const { action, level } = typeof command === "string" ? { action: command, level: undefined } : command;
    if (action === "volume_up") return setVolume(settings.volume + 0.15);
    if (action === "volume_down") return setVolume(settings.volume - 0.15);
    if (action === "set_volume") return setVolume((level ?? 80) / 100);
    if (action === "stop") {
      interrupt();
      return "Stopped.";
    }
    if (action === "show_brain") return openBrain();
    if (!orb?.alive) return "No orb is open.";
    orb.send({ type: "ui", action });
    const done: Record<Exclude<UiAction, "stop" | "show_brain" | "volume_up" | "volume_down" | "set_volume">, string> = {
      minimise: "Minimised to the menu bar.",
      show: "The orb is back.",
      close_panels: "Closed the panels.",
      show_last_detail: "Re-opened the last detail panel (if there was one).",
      show_last_map: "Re-opened the last map (if there was one).",
    };
    return done[action];
  };

  /** Opens a dialog: registers it for interruption, and always closes it out, however it was answered. */
  const openDialog = async <T,>(run: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> => {
    const answered = new AbortController();
    asking = true;
    currentAsk = answered;
    try {
      return await run(answered.signal);
    } finally {
      answered.abort();
      asking = false;
      currentAsk = null;
    }
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
    status: (text, input) => {
      console.log(`  ${text}`);
      const tool = text.match(/^→ (\S+)/)?.[1];
      const friendly = tool ? describeActivity(tool, input) : text === "… thinking" ? "Thinking…" : text;
      orb?.send({ type: "activity", text: friendly, glyph: tool ? activityGlyph(tool) : "sun" });
    },
    // Approvals: the orb's card (or the pop-up without it), a spoken answer, or a typed one; first answer wins.
    // If she's mid-sentence the question isn't spoken over her: the card is enough, and she listens once she's done.
    ask: async ({ spoken, detail }) => {
      console.log(`\n  Approval needed: ${detail}`);
      const answer = await openDialog<Answer>((signal) => {
        const viaCard = orb?.alive ? orb.ask(spoken, detail, signal) : askDialog(detail, signal);
        if (speaker.busy) console.log(`  (on screen: ${spoken})`);
        else void say(spoken);
        const where = orb?.alive ? "the orb" : "the pop-up";
        const viaTyped = lines
          .next(voiceMode ? `[say yes, always or no, click ${where}, or type y / a / n] ` : `[click ${where}, or type y / a / n] `, signal)
          .then((line) => (line === null || !line.trim() ? null : parseAnswer(line)));
        const viaVoice = voiceAnswer(parseVoiceApproval, "Sorry, was that yes, always, or no?", signal);
        return firstAnswer<Answer>([viaCard, viaTyped, viaVoice]);
      });
      console.log(`  → ${answer ?? "no"}`);
      return answer ?? "no";
    },
    // ask_user: a question card with options, answerable by voice, click or typing.
    question: async (spec) => {
      console.log(`\n  Question: ${spec.question}`);
      spec.options.forEach((o, i) => console.log(`    ${i + 1}. ${o.label}${o.description ? ` (${o.description})` : ""}`));
      const answer = await openDialog<QuestionAnswer>((signal) => {
        const viaCard = orb?.alive ? orb.question(spec, signal) : Promise.resolve(null);
        const spokenQ = speakQuestion(spec.question, spec.options);
        if (speaker.busy) console.log(`  (on screen: ${spokenQ})`);
        else void say(spokenQ);
        const viaTyped = lines
          .next(spec.options.length ? "[say it, click, or type a number (1,3 for several) or an answer] " : "[say or type your answer] ", signal)
          .then((line) => (line === null ? null : parseTypedChoice(line, spec)));
        const viaVoice = voiceAnswer((text) => parseSpokenChoice(text, spec), spec.options.length ? "Sorry, which one?" : "Sorry, say that again?", signal);
        return firstAnswer<QuestionAnswer>([viaCard, viaTyped, viaVoice]);
      });
      console.log(`  → ${answer === null ? "(no answer)" : Array.isArray(answer) ? answer.join(", ") : answer}`);
      return answer;
    },
    // ui_control: Astra working her own interface (panels, minimise, stop).
    ui: (action, level) => runUi({ action, level }),
  });
  await jarvis.init();

  // Closing the terminal tab (SIGTERM) shuts down cleanly too: a hard exit would crash the voice engine.
  process.on("SIGTERM", () => {
    interrupt();
    quitting = true;
    lines.inject("/quit");
  });

  rl.on("SIGINT", () => {
    if (interrupt()) {
      console.log("\n(stopped)");
      return;
    }
    rl.close();
  });

  void wakeLoop();

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
    orb?.send({ type: "activity-reset" });
    orb?.send({ type: "activity", text: "Thinking…", glyph: "sun" });
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

  quitting = true;
  await wakeListener.cancel();
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
