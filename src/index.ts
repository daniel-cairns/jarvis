import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { activityGlyph, describeActivity, transferKind, type Transfer } from "./activity.js";
import { Jarvis, type Approval } from "./agent.js";
import { loadConfig } from "./config.js";
import { parseAnswer, type Answer } from "./permissions.js";
import { renderDetail } from "./ui/detail.js";
import { checkGraph, graphAsText, graphShape } from "./ui/graph.js";
import { brainIndex, noteMap, readNote, saveNote } from "./tools/brain.js";
import { openApp, realRunner } from "./tools/mac.js";
import { ComputerControl, nativeHelper } from "./control/computer.js";
import { CoffeeMode } from "./power/coffee.js";
import { Tallyline } from "./tools/tallyline.js";
import { RESTART_CHECK_MS, RESTART_REPORT_MS, restartBlocker, stillBlockedMessage, waitingMessage, type RestartState } from "./ui/restart.js";
import { buildSessionsView } from "./ui/sessionsPanel.js";
import type { SessionAction } from "./ui/orb.js";
import type { RunPhase } from "./ui/orb.js";
import { fileDiff, gitRoot, repoState, type RepoState } from "./tools/git.js";
import { WorkLog, type ToolEvent } from "./ui/worklog.js";
import { SessionRunner, type Job } from "./tools/runner.js";
import type { SessionTools, WindowTools } from "./tools/server.js";
import { appLinks, findSession, listSessions, liveStatus, resolveProject, type SessionSummary } from "./tools/sessions.js";
import { newlyWaiting, sitrep } from "./tools/sitrep.js";
import { pickLastSession, saveLastSession } from "./tools/lastSession.js";
import { z } from "zod";
import { stopServing } from "./tools/serve.js";
import { isStopCommand, localCommand, type UiAction, type UiCommand } from "./ui/control.js";
import { WindowHistory, type WindowKind } from "./ui/windows.js";
import { clampVolume, loadSettings, saveSettings } from "./settings.js";
import { askDialog } from "./ui/dialog.js";
import { Orb, type ToOrb } from "./ui/orb.js";
import { Listener } from "./voice/listener.js";
import { Speaker } from "./voice/speaker.js";
import { KokoroTts, SayTts } from "./voice/tts.js";
import {
  parseSpokenChoice,
  parseTypedChoice,
  parseVoiceApproval,
  speakQuestion,
  type QuestionAnswer,
  type QuestionSpec,
} from "./voice/answers.js";
import { clock, splitStop, transcriptMarkdown, wordCount, type TranscriptLine } from "./voice/transcript.js";
import { matchWake, matchWakeAnywhere, speechHint, stripOwnSpeech } from "./voice/wake.js";

const HELP = `Say "Astra" to wake her. Commands: /new (fresh conversation), /continue (pick up the last one), /brain, /stack (tidy her windows), /sitrep, /god on|off, /restart, /type (type only: mic off, silent), /voice, /transcript [title] (record until "stop recording"), /mute, /unmute, /wake on|off, /help, /quit. Ctrl-C or Esc on the orb stops her.`;
// Prefixed to each request while god mode is on.
const GOD_MODE =
  "(God mode is on: you command the user's Claude Code sessions. Hand project work to them rather than doing it yourself: " +
  "check sessions_list, send a clear, self-contained instruction to the right idle session with session_send, or start one " +
  "in the right project with session_start (background). Tell the user who you gave what. For \"sit rep\" use ui_control " +
  "sitrep. Only do quick things yourself.)\n\n";

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
    // The repo's own .env, wherever the repo lives and whatever folder she was started from.
    process.loadEnvFile(new URL("../.env", import.meta.url));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const cfg = loadConfig();

  let orb: Orb | null = null;
  let ownSpeech = "";
  let lastSpokeAt = 0;
  // Her recent sentences with when she said them, to cut her own voice out of what the mic heard.
  const spoken: { text: string; at: number }[] = [];
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
      spoken.push({ text: u.text, at: lastSpokeAt });
      if (spoken.length > 20) spoken.shift();
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
  // Started from Astra.app there's no Terminal: stdin is empty and would end at once, quitting her main loop. Then
  // she reads from a stream that never ends instead, and typing comes in through the orb's type box.
  const interactive = process.stdin.isTTY === true;
  const rl = readline.createInterface({ input: interactive ? process.stdin : new PassThrough(), output: process.stdout, terminal: interactive });
  const lines = new LineReader(rl);
  let asking = false;
  let currentAsk: AbortController | null = null;
  let currentListen: AbortController | null = null;
  let quitting = false;
  // While a dialog is open, "Astra …" (or a click on the orb) goes to it instead of starting a new request.
  let dialogWake: ((request: string) => void) | null = null;
  /** While a dialog listens for a spoken answer: whether some text would answer it. */
  let dialogParses: ((text: string) => boolean) | null = null;
  // A request heard via the wake word and queued for the main loop, so it's treated as spoken.
  let wokeWith: string | null = null;

  // Long transcript mode: the recording in progress, a transcript asked for mid-request (it starts when the request
  // ends), and the last one saved, which the next request is told about so "summarise that" works.
  let transcribing: AbortController | null = null;
  let pendingTranscript: { title?: string } | null = null;
  let lastTranscript: string | null = null;
  // Asked to restart while working or running background sessions: she restarts once all of that has finished.
  let pendingRestart = false;

  // Operating Mac apps (src/control/): every action logged, risky ones confirmed on a card, all halted by "stop".
  const computer = new ComputerControl(nativeHelper(path.join(cfg.home, "bin")), {
    ownPids: () => [process.pid, ...(orb?.pid ? [orb.pid] : [])],
    confirm: async (question) => {
      if (!orb?.alive) return false;
      const asked = new AbortController();
      computer.stopper.signal.addEventListener("abort", () => asked.abort(), { once: true });
      const yes = "Yes, go ahead";
      const answer = await orb.question({ question, options: [{ label: yes }, { label: "No" }], multiSelect: false, allowOther: false }, asked.signal);
      return (Array.isArray(answer) ? answer[0] : answer) === yes;
    },
    log: (line) => {
      console.log(`[control] ${line}`);
      orb?.send({ type: "caption", role: "status", text: line });
    },
    indicator: (on) => orb?.send({ type: "control", on }),
    open: async (target) => {
      if (/^(x-apple\.systempreferences|https?):/.test(target)) await realRunner.run("open", [target]);
      else await openApp(target);
    },
  });

  /** Stops speech, listening, a pending approval, control of the Mac and the request in progress. Returns whether anything was running. */
  const interrupt = (): boolean => {
    const active = speaking || listening || busy;
    computer.stop();
    speaker.stop();
    transcribing?.abort();
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
        // Quit means quit: a restart that was waiting must not fire when the interrupted reply ends (that's why
        // "Quit Astra" used to restart her) and no restart flag may be left for the launcher to see.
        cancelPendingRestart();
        rmSync(path.join(cfg.home, "restart"), { force: true });
        interrupt();
        quitting = true;
        lines.inject("/quit");
      },
      onBrain: (msg) => void onBrain(msg),
      onGitDiff: (msg) => void onGitDiff(msg),
      onPanelClosed: (kind) => {
        if (kind === "sessions") sessionsPanelOpen = false;
        if (kind === "tallyline") tallylineOpen = false;
      },
      onSessionAction: (msg) => void onSessionAction(msg),
      onPanelOpened: (kind) => {
        if (kind === "sessions") {
          sessionsPanelOpen = true;
          void refreshSessions();
        }
        if (kind === "tallyline") {
          tallylineOpen = true;
          void refreshTallyline();
        }
      },
      onVolume: (msg) => void setVolume(msg.level ?? settings.volume + (msg.delta ?? 0)),
      onRecord: () => onRecord(),
      // "Continue last session" from the menu bar.
      onContinue: () => void runUi("continue_session").then((what) => console.log(`\n  ${what}`)),
      // "Restart Astra" from the menu bar: now if she's free, otherwise once her work is done (she says which).
      onRestart: () => {
        const what = requestRestart();
        console.log(`\n  ${what}`);
        orb?.send({ type: "caption", role: "status", text: what });
      },
      onTypeOnly: (on) => console.log(`\n  ${setTypeOnly(on)}`),
      // Same as typing in the terminal: a request at the prompt, or an answer to an open approval or question.
      onTyped: (text) => {
        console.log(text);
        orb?.send({ type: "caption", role: "you", text });
        if (busy && !asking) orb?.send({ type: "caption", role: "status", text: "Queued: I'll do that next" });
        lines.inject(text);
      },
      onStop: () => {
        if (interrupt()) {
          console.log("\n(stopped)");
          orb?.send({ type: "caption", role: "status", text: "Stopped" });
        }
      },
    });
  }

  orb?.send({ type: "volume-level", level: settings.volume, quiet: true });

  // micReady: the microphone works and wasn't switched off with --text. voiceMode: listening now (off in type-only).
  let micReady = !textMode;
  if (micReady) {
    const problems = await listener.checkSetup();
    if (problems.length) {
      console.log("Voice input isn't ready, so I'll use typed mode:\n  " + problems.join("\n  "));
      micReady = false;
    }
  }
  let voiceMode = micReady && !settings.typeOnly;
  const sendMode = () => orb?.send({ type: "mode", typeOnly: settings.typeOnly, god: settings.godMode });
  sendMode();

  /** Type-only mode: microphone off (no wake word or listening) and silent; replies only on screen. Remembered. */
  const setTypeOnly = (on: boolean): string => {
    settings.typeOnly = on;
    saveSettings(cfg.home, settings);
    voiceMode = micReady && !on;
    if (on) {
      speaker.stop();
      currentListen?.abort();
      void wakeListener.cancel();
    }
    sendMode();
    if (on) return "Type-only mode: microphone off and I'll stay quiet. Type /voice or click the mouth glyph to switch back.";
    return micReady ? "Voice mode: listening and talking again." : "Speech is back on, but the microphone isn't available.";
  };

  // Queued: lines never overlap (see Speaker). Resolves when this line has been spoken.
  const say = async (text: string) => {
    console.log(`\nAstra: ${text}\n`);
    if (muted || settings.typeOnly || !speechEnabled) orb?.send({ type: "caption", role: "jarvis", text });
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
      const raw = herVoice ? matchWakeAnywhere(heard, ownSpeech) : matchWake(heard);
      const request =
        raw !== null && herVoice ? stripOwnSpeech(raw, spoken.filter((s) => s.at >= startedAt - 15_000).map((s) => s.text)) : raw;
      if (process.env.JARVIS_DEBUG_WAKE) console.log(`  (wake ${herVoice ? "over her voice" : "idle"} heard: "${heard}" → ${request === null ? "ignored" : `"${request}"`})`);
      if (request !== null) onWake(request);
      else if (dialogParses && heard.trim()) answerWithoutName(heard, herVoice, startedAt);
    }
  };

  /**
   * A card is waiting and the always-on listener heard something without her name. When she wasn't talking, an
   * answer is taken as it is ("the first one" once her listening window has closed). Over her own voice it can't be
   * trusted (she has just read the options aloud), so if it holds words she didn't say and reads as an answer, she
   * stops talking and listens for it properly.
   */
  const answerWithoutName = (heard: string, herVoice: boolean, startedAt: number) => {
    if (!dialogParses || !dialogWake) return;
    if (!herVoice) {
      if (dialogParses(heard)) {
        chime();
        dialogWake(heard);
      }
      return;
    }
    const hers = new Set(
      spoken
        .filter((s) => s.at >= startedAt - 15_000)
        .flatMap((s) => s.text.toLowerCase().split(/[^\p{L}\p{N}']+/u)),
    );
    const extra = heard.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((w) => w.length > 1 && !hers.has(w));
    if (extra.length && dialogParses(heard)) {
      console.log("  (you answered over me: stopping to listen)");
      speaker.stop();
      dialogWake("");
    }
  };

  /** Shows that a command was handled on the spot, without a round trip to Claude. */
  const announceLocal = (cmd: UiCommand | string) => {
    const what =
      typeof cmd === "string"
        ? cmd
        : `${cmd.action.replace(/_/g, " ")}${cmd.level !== undefined ? ` ${cmd.level}` : ""}${cmd.position ? ` ${cmd.position.replace(/_/g, " ")}` : ""}`;
    console.log(`\n  ⚡ ${what}`);
    orb?.send({ type: "caption", role: "status", text: `⚡ ${what}` });
  };

  /** "Astra …" was heard: a quick UI command, an answer to an open dialog, or a request (barging in on her). */
  const onWake = (request: string) => {
    chime();
    if (isStopCommand(request)) {
      if (interrupt()) {
        console.log("\n(stopped)");
        orb?.send({ type: "caption", role: "status", text: "Stopped" });
      }
      return;
    }
    const local = dialogWake ? null : localCommand(request);
    if (local && "ui" in local) {
      announceLocal(local.ui);
      return void runUi(local.ui);
    }
    if (dialogWake) return dialogWake(request);
    // A slash command ("start a new conversation" → /new) doesn't interrupt what she's doing; a request does.
    const line = local ? local.slash : request;
    if (!local || local.slash === "/quit") {
      if (busy || speaking) interrupt();
    }
    if (line) wokeWith = line;
    lines.inject(line);
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
    dialogParses = (text) => parse(text) !== null;
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
          const startedAt = Date.now();
          heard = await listenOnce(12_000, signal);
          // She started talking while this was recording (a line queued after the question): that's her voice,
          // not an answer. Throw it away and listen again once she's done.
          if (heard && lastSpokeAt >= startedAt) {
            console.log("  (that was my own voice; listening again)");
            tries--;
            continue;
          }
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
      dialogParses = null;
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

  // Windows she's shown, so you can ask for any of them back after she tidies them away (see orb/main.cjs tidyUp).
  const windows = new WindowHistory();
  let requestCount = 0;
  const remember = (kind: WindowKind, title: string, reopen: () => void | Promise<void>, key = `${kind}:${title}`) =>
    windows.record({ key, kind, title, at: Date.now(), request: requestCount, reopen });

  /** Shows a detail panel or map and remembers it. Reopened on request, it's yours: she won't close it on you. */
  const showPanel = (msg: Extract<ToOrb, { type: "detail" | "graph" }>) => {
    orb?.send(msg);
    remember(msg.type, msg.title, () => orb?.send({ ...msg, owner: "user" }));
  };

  /** She's finished and no background session is running: the orb closes the panels that aren't needed any more. */
  const tidyWindows = () => {
    if (!busy && !sessionRunner.list().some((j) => j.status === "running")) orb?.send({ type: "request-done" });
  };

  /** Opens the brain browser (every note and teardown), or lists them in the terminal without the orb. */
  const openBrain = async (owner?: "user"): Promise<string> => {
    const notes = await brainIndex(cfg.brainDir);
    if (!orb?.alive) {
      for (const n of notes) console.log(`  ${n.folder}/ ${n.title}`);
      return `Listed ${notes.length} notes in the terminal.`;
    }
    orb.send({ type: "brain", notes, ...(owner ? { owner } : {}) });
    remember("brain", "Brain browser", () => void openBrain("user"));
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
      // Opened from the brain browser, so it's yours.
      showPanel({ type: "graph", title: msg.path.split("/").at(-1)!.replace(/\.md$/, ""), graph, owner: "user" });
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
    const { action, level, position } = typeof command === "string" ? { action: command, level: undefined, position: undefined } : command;
    if (action === "move") {
      if (!position) return "Say where: a spot like top_left or centre, or a nudge.";
      if (!orb?.alive) return "No orb is open.";
      orb.send({ type: "ui", action, position });
      return `Moving ${position.startsWith("nudge_") ? position.slice(6) : `to the ${position.replace("_", " ")}`}.`;
    }
    if (action === "show_terminal") {
      sendTerminal(true);
      return "Showing my terminal.";
    }
    if (action === "show_git") {
      await refreshGit(true);
      return repos.length ? `Showing changes in ${repos.map((r) => r.name).join(", ")}.` : "Showing the git panel; I haven't touched a repo yet.";
    }
    if (action === "volume_up") return setVolume(settings.volume + 0.15);
    if (action === "volume_down") return setVolume(settings.volume - 0.15);
    if (action === "set_volume") return setVolume((level ?? 80) / 100);
    if (action === "stop") {
      interrupt();
      return "Stopped.";
    }
    if (action === "show_brain") return openBrain();
    if (action === "reopen_windows") return windowTools.show("all");
    if (action === "restart") return requestRestart();
    if (action === "continue_session") {
      if (busy) {
        pendingContinue = true;
        return "I'll pick up our last conversation as soon as this reply ends.";
      }
      // Through the main loop, so nothing else talks to her while she switches conversations.
      lines.inject("/continue");
      return "Picking up our last conversation.";
    }
    if (action === "type_only" || action === "voice_mode") return setTypeOnly(action === "type_only");
    if (action === "god_mode_on" || action === "god_mode_off") return setGodMode(action === "god_mode_on");
    if (action === "sitrep") {
      // Asked mid-request (via ui_control), she tells it in her reply; asked directly, she says it now.
      const spoken = await showSitrep();
      if (busy) return `Sit rep is on screen. Tell the user: ${spoken}`;
      await say(spoken);
      return "Sit rep given.";
    }
    if (action === "start_transcript") {
      if (!busy) {
        await runTranscript();
        return "Transcript finished.";
      }
      pendingTranscript = {};
      return "Recording starts as soon as this reply ends.";
    }
    if (action === "show_tallyline") return showTallyline();
    if (action === "show_sessions") {
      if (!orb?.alive) return "No orb is open.";
      await refreshSessions("user");
      return "Showing your open sessions. It keeps itself up to date while it's open.";
    }
    if (!orb?.alive) return "No orb is open.";
    orb.send({ type: "ui", action });
    const done: Record<Exclude<UiAction, "show_tallyline" | "show_sessions" | "continue_session" | "reopen_windows" | "stop" | "show_brain" | "start_transcript" | "restart" | "type_only" | "voice_mode" | "sitrep" | "god_mode_on" | "god_mode_off" | "volume_up" | "volume_down" | "set_volume" | "move" | "show_terminal" | "show_git">, string> = {
      minimise: "Minimised to the menu bar.",
      show: "The orb is back.",
      close_panels: "Closed the panels.",
      collapse_panel: "Collapsed the thinking window.",
      expand_panel: "Expanded the thinking window.",
      show_last_detail: "Re-opened the last detail panel (if there was one).",
      show_last_map: "Re-opened the last map (if there was one).",
      stack_windows: "Tidied up my panels.",
    };
    return done[action];
  };

  /**
   * Long transcript mode: records until you say "stop recording" (or press Enter, click the orb or stop). Chunks end at
   * pauses and the next starts before the last is transcribed, so nothing said in between is lost. She stays quiet
   * while recording; the transcript shows live in the detail panel and is saved to the brain under transcripts.
   */
  const runTranscript = async (title = "Transcript"): Promise<void> => {
    if (!micReady) return void console.log("  Transcript mode needs the microphone.");
    await say('Recording. Say "Astra, stop recording" when you\'re done.');
    await speaker.whenIdle();
    const stop = new AbortController();
    transcribing = stop;
    orb?.send({ type: "recording", on: true });
    const startedAt = Date.now();
    const found: TranscriptLine[] = [];
    const show = (endedAt?: number) => {
      const msg = { type: "detail", title, html: renderDetail(transcriptMarkdown(title, startedAt, found, endedAt)), follow: true } as const;
      // The live updates just refresh the panel; the finished transcript is remembered so you can bring it back.
      if (endedAt) showPanel(msg);
      else orb?.send(msg);
    };
    const label = () => orb?.send({ type: "state-label", text: `Recording ${clock(Date.now() - startedAt)}` });
    refreshHint();
    listening = true;
    syncOrb();
    show();
    label();
    const timer = setInterval(label, 1_000);
    console.log('  🔴 Recording. Say "Astra, stop recording", or press Enter, to finish.');
    // Enter (or a click on the orb, which stands in for it) stops it too.
    void lines.next("", stop.signal).then((line) => line !== null && stop.abort());

    const chunk = { autoStop: true, pauseSec: cfg.pauseSec, gainDb: cfg.micGainDb, noSpeechMs: Infinity, maxMs: 60_000 };
    const recorders: [Listener, Listener] = [new Listener(listenCfg), new Listener(listenCfg)];
    const aborted = new Promise<void>((resolve) => stop.signal.addEventListener("abort", () => resolve(), { once: true }));
    let saidStop = false;
    let transcribed = Promise.resolve();
    const transcribe = (recorder: Listener, at: number) => {
      transcribed = transcribed.then(async () => {
        const heard = await recorder.stopAndTranscribe().catch((err: Error) => {
          console.log(`  (couldn't transcribe a chunk: ${err.message})`);
          return "";
        });
        if (saidStop) return;
        const { kept, stop: said } = splitStop(heard);
        if (kept) {
          found.push({ at, text: kept });
          console.log(`  [${clock(at - startedAt)}] ${kept}`);
          show();
        }
        if (said) {
          saidStop = true;
          stop.abort();
        }
      });
    };
    let turn = 0;
    let current: Listener = recorders[0];
    await current.start(chunk);
    let chunkStart = Date.now();
    while (!stop.signal.aborted) {
      const ended = await Promise.race([current.whenDone().then(() => true), aborted.then(() => false)]);
      if (!ended) break;
      const done = current;
      const at = chunkStart;
      current = recorders[++turn % 2 as 0 | 1];
      await current.start(chunk);
      chunkStart = Date.now();
      transcribe(done, at);
    }
    // Stopped by Enter or a click mid-sentence: keep that last sentence. Said "stop recording": nothing after it counts.
    if (current.recording && !saidStop) transcribe(current, chunkStart);
    else await current.cancel();
    await transcribed;
    await Promise.all(recorders.map((r) => (r.recording ? r.cancel() : undefined)));
    clearInterval(timer);
    transcribing = null;
    orb?.send({ type: "recording", on: false });
    listening = false;
    syncOrb();

    const endedAt = Date.now();
    show(endedAt);
    if (!found.length) return void (await say("I didn't catch anything, so there's nothing to save."));
    const notePath = await saveNote(cfg.brainDir, {
      title,
      body: transcriptMarkdown(title, startedAt, found, endedAt).replace(/^# .*\n\n/, ""),
      folder: "transcripts",
      tags: ["transcript"],
    });
    lastTranscript = path.relative(cfg.brainDir, notePath);
    console.log(`  Saved to ${notePath}`);
    const minutes = Math.round((endedAt - startedAt) / 60_000);
    const length = minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "under a minute";
    const words = wordCount(found);
    await say(`Saved: ${length}, ${words} word${words === 1 ? "" : "s"}. Want a summary or the action items?`);
  };

  /**
   * Restarts her with her latest code: leaves a flag for scripts/astra.sh (npm start), which runs her again, and quits.
   * Waits for the request in progress and her background sessions, since quitting would stop them.
   */
  /** Records the conversation she's in, so "continue last session" can pick it up after a restart. */
  const rememberSession = () => {
    const id = jarvis.session;
    if (id) saveLastSession(cfg.home, id);
  };

  // "Continue last session", asked for mid-request: it resumes once the request ends.
  let pendingContinue = false;

  /**
   * Picks up her previous conversation (the same Claude Code session, resumed with its full context) and says briefly
   * what she was last doing. Only when asked: every launch starts fresh. If it can't be resumed she says why plainly
   * and stays in the fresh conversation.
   */
  const continueLast = async (): Promise<void> => {
    const pick = await pickLastSession({
      home: cfg.home,
      workspaceDir: cfg.workspaceDir,
      current: jarvis.session,
      exclude: sessionRunner.list().flatMap((j) => (j.sessionId ? [j.sessionId] : [])),
    });
    if ("problem" in pick) return void (await say(`${pick.problem} I'm staying in this fresh conversation.`));
    const fresh = jarvis.session;
    jarvis.resumeFrom(pick.id);
    busy = true;
    computer.resume();
    syncOrb();
    orb?.send({ type: "activity-reset" });
    orb?.send({ type: "activity", text: "Picking up where we left off…", glyph: "water" });
    try {
      const result = await jarvis.handle(
        "(The user asked to continue our last conversation after a restart.) In one or two short sentences, tell them " +
          "what you were last doing and what was next. Don't start any work until they say.",
      );
      if (!result.ok) throw new Error(result.summary);
      rememberSession();
      console.log(`  (continued session ${pick.id} · $${result.costUsd.toFixed(3)})`);
    } catch (err) {
      jarvis.resumeFrom(fresh);
      await say(`I couldn't pick up our last conversation (${(err as Error).message}). I'm staying in this fresh one.`);
    } finally {
      busy = false;
      syncOrb();
    }
  };

  /** What a restart would be waiting on right now. */
  const restartState = (): RestartState => ({
    busy,
    running: sessionRunner.list().filter((j) => j.status === "running").map((j) => `${j.id} (${j.label})`),
  });
  let restartTimer: NodeJS.Timeout | undefined;
  let restartSince = 0;
  let restartReported = false;
  const cancelPendingRestart = () => {
    pendingRestart = false;
    clearInterval(restartTimer);
    restartTimer = undefined;
  };

  const requestRestart = (): string => {
    if (quitting) return "I'm already on my way out.";
    const state = restartState();
    if (!restartBlocker(state)) {
      cancelPendingRestart();
      rememberSession();
      writeFileSync(path.join(cfg.home, "restart"), new Date().toISOString());
      console.log("\n(restarting)");
      quitting = true;
      lines.inject("/quit");
      return "Restarting.";
    }
    // It has to wait. It used to be checked only when a reply or a run ended, so a restart asked for at other times
    // could wait forever; now it's re-checked every few seconds, and if it's still blocked after a while she says by
    // what, rather than having promised a restart that never comes.
    if (!pendingRestart) {
      pendingRestart = true;
      restartSince = Date.now();
      restartReported = false;
      restartTimer = setInterval(restartIfDue, RESTART_CHECK_MS);
      restartTimer.unref();
    }
    return waitingMessage(state);
  };
  const restartIfDue = () => {
    if (!pendingRestart || quitting) return;
    const state = restartState();
    if (!restartBlocker(state)) {
      cancelPendingRestart();
      void say("Restarting now.").then(requestRestart);
    } else if (!restartReported && Date.now() - restartSince >= RESTART_REPORT_MS) {
      restartReported = true;
      const note = stillBlockedMessage(state);
      console.log(`\n  ${note}`);
      orb?.send({ type: "caption", role: "status", text: note });
      void say(note);
    }
  };

  /**
   * The record glyph: stops the transcript running, or starts one. Busy, it starts when the request ends; mid-listen,
   * the listening is cut short and the main loop starts it (a line injected then would only end the recording).
   */
  const onRecord = () => {
    if (transcribing) return transcribing.abort();
    if (busy || asking) {
      pendingTranscript = {};
      orb?.send({ type: "caption", role: "status", text: "Recording starts when I've finished this" });
    } else if (listening) {
      pendingTranscript = {};
      currentListen?.abort();
    } else lines.inject("/transcript");
  };

  /** Opens a dialog: registers it for interruption, and always closes it out, however it was answered. */
  let dialogQueue: Promise<void> = Promise.resolve();
  const openDialog = async <T,>(run: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> => {
    // One dialog at a time: a background session's approval waits for the one on screen.
    const previous = dialogQueue;
    let release!: () => void;
    dialogQueue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    const answered = new AbortController();
    asking = true;
    currentAsk = answered;
    try {
      return await run(answered.signal);
    } finally {
      answered.abort();
      asking = false;
      currentAsk = null;
      release();
    }
  };

  // Approvals: the orb's card (or the pop-up without it), a spoken answer, or a typed one; first answer wins. Used
  // by Astra and by the sessions she runs in the background. If she's mid-sentence the question isn't spoken over
  // her: the card is enough, and she listens once she's done.
  const askApproval = async ({ spoken, detail }: Approval): Promise<string> => {
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
  };

  // ── The terminal and git panels: what she (and her background sessions) run and change ──
  const work = new WorkLog();
  let repos: RepoState[] = [];
  let terminalTimer: NodeJS.Timeout | undefined;
  let gitTimer: NodeJS.Timeout | undefined;

  const sendTerminal = (force = false, owner?: "user") => {
    orb?.send({
      type: "terminal",
      force,
      ...(owner ? { owner } : {}),
      entries: work.entries.slice(-40).map((e) => ({ ...e, output: e.output.length > 4000 ? `…${e.output.slice(-4000)}` : e.output })),
    });
    if (work.entries.length) remember("terminal", "Terminal", () => sendTerminal(true, "user"));
  };

  /** Re-reads the repos her commands and edits touched (the three most recent) and updates the git panel. */
  const refreshGit = async (force = false, owner?: "user") => {
    const roots: string[] = [];
    for (const dir of work.touched) {
      const root = await gitRoot(dir);
      if (root && !roots.includes(root)) roots.push(root);
      if (roots.length === 3) break;
    }
    repos = (await Promise.all(roots.map((r) => repoState(r).catch(() => null)))).filter((r): r is RepoState => r !== null);
    if (repos.length || force) orb?.send({ type: "git", repos, force, ...(owner ? { owner } : {}) });
    if (repos.length) remember("git", `Git changes (${repos.map((r) => r.name).join(", ")})`, () => refreshGit(true, "user"), "git");
  };

  // Uploads and downloads in progress (hers and her background sessions'), for the orb's laser array and mothership.
  const transfers = new Map<string, { dir: Transfer; at: number; source: string }>();
  let shownTransfer: Transfer | null = null;
  const syncTransfer = () => {
    const stale = Date.now() - 10 * 60_000;
    for (const [id, t] of transfers) if (t.at < stale) transfers.delete(id);
    const dirs = [...transfers.values()].map((t) => t.dir);
    const now = dirs.includes("up") ? "up" : dirs.includes("down") ? "down" : null;
    if (now === shownTransfer) return;
    shownTransfer = now;
    orb?.send({ type: "transfer", dir: now });
  };

  // The guardian on the orb: up while any security check runs, and for a moment after so a quick one is seen.
  let checksRunning = 0;
  let guardHide: NodeJS.Timeout | undefined;
  const onGuard = (phase: "start" | "ok" | "blocked") => {
    clearTimeout(guardHide);
    if (phase === "start") {
      checksRunning++;
      orb?.send({ type: "guard", state: "checking" });
      return;
    }
    checksRunning = Math.max(0, checksRunning - 1);
    if (phase === "blocked") orb?.send({ type: "guard", state: "blocked" });
    if (!checksRunning) guardHide = setTimeout(() => orb?.send({ type: "guard", state: null }), phase === "blocked" ? 4_000 : 1_800);
  };

  const onToolEvent = (source: string, cwd: string, e: ToolEvent) => {
    const dir = e.kind === "use" ? transferKind(e.name, e.input) : null;
    if (dir) transfers.set(e.id, { dir, at: Date.now(), source });
    if (dir || (e.kind === "result" && transfers.delete(e.id))) syncTransfer();
    const changed = work.record(source, cwd, e);
    if (changed.terminal) {
      clearTimeout(terminalTimer);
      terminalTimer = setTimeout(() => sendTerminal(), 120);
    }
    if (changed.files) {
      clearTimeout(gitTimer);
      gitTimer = setTimeout(() => void refreshGit(), 800);
    }
  };

  /** The git panel asked for a file's diff: only for repos and files it was shown. */
  const onGitDiff = async ({ root, path: file }: { root: string; path: string }) => {
    const repo = repos.find((r) => r.root === root);
    if (!repo || !repo.files.some((f) => f.path === file)) return;
    const diff = await fileDiff(root, file).catch((err: Error) => `Couldn't read the diff: ${err.message}`);
    orb?.send({ type: "git-diff-result", root, path: file, diff });
  };

  // The live transcript panel for background runs: what each run says and does, newest at the bottom.
  type TranscriptKind = "prompt" | "text" | "tool" | "end";
  const transcripts = new Map<string, { kind: TranscriptKind; text: string }[]>();
  const transcriptTimers = new Map<string, NodeJS.Timeout>();
  /** What each run is doing right now, for the glyph row at the top of its transcript. */
  const runPhases = new Map<string, RunPhase>();
  /** Shows a run's transcript (now, or within 250 ms so a burst of steps is one update). */
  const showTranscript = (job: Job, owner?: "user") => {
    const send = () => {
      transcriptTimers.delete(job.id);
      const lines = transcripts.get(job.id) ?? [];
      sessionsChanged();
      const state: RunPhase = job.status === "running" ? (runPhases.get(job.id) ?? { phase: "thinking" }) : { phase: job.status };
      orb?.send({ type: "transcript", job: { id: job.id, label: job.label, status: job.status }, lines, state, ...(owner ? { owner } : {}) });
    };
    if (owner) return send();
    if (!transcriptTimers.has(job.id)) transcriptTimers.set(job.id, setTimeout(send, 250));
  };
  const addLine = (job: Job, kind: TranscriptKind, text: string) => {
    const lines = transcripts.get(job.id) ?? [];
    lines.push({ kind, text: text.length > 2000 ? `${text.slice(0, 1999)}…` : text });
    if (lines.length > 300) lines.splice(0, lines.length - 300);
    transcripts.set(job.id, lines);
    showTranscript(job);
  };
  /** A background run began: its transcript opens straight away and is remembered for show_window. */
  const startTranscript = (job: Job) => {
    transcripts.set(job.id, [{ kind: "prompt", text: job.prompt }]);
    showTranscript(job);
    remember("transcript", `Transcript: ${job.label} (${job.id})`, () => showTranscript(job, "user"), `transcript:${job.id}`);
  };

  /** A question card (ask_user, or a background run's AskUserQuestion), answerable by voice, click or typing. */
  async function askQuestion(spec: QuestionSpec): Promise<QuestionAnswer | null> {
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
  }

  // ── Your other Claude Code sessions: read them, start or continue them in the background, open them in the app ──
  const sessionRunner = new SessionRunner(cfg, {
    activity: (job, tool, input) => {
      console.log(`  [${job.id} ${job.label}] → ${tool}`);
      orb?.send({ type: "activity", text: `${job.label}: ${describeActivity(tool, input)}`, glyph: activityGlyph(tool) });
      runPhases.set(job.id, { phase: "tool", glyph: activityGlyph(tool) });
      addLine(job, "tool", describeActivity(tool, input));
    },
    said: (job, text) => {
      runPhases.set(job.id, { phase: "thinking" });
      addLine(job, "text", text);
    },
    // Its own questions come to Dan as Astra's question cards, named for the run, and his answers go back to it.
    question: async (job, spec) => {
      runPhases.set(job.id, { phase: "waiting" });
      showTranscript(job);
      try {
        if (!orb?.alive && !voiceMode) return null;
        return await askQuestion({ ...spec, question: `${job.label} (${job.id}) asks: ${spec.question}` });
      } finally {
        runPhases.set(job.id, { phase: "thinking" });
        showTranscript(job);
      }
    },
    ask: async (job, approval) => {
      runPhases.set(job.id, { phase: "waiting" });
      showTranscript(job);
      try {
        return await askApproval(approval);
      } finally {
        runPhases.set(job.id, { phase: "thinking" });
        showTranscript(job);
      }
    },
    toolEvent: (job, e) => onToolEvent(job.label, job.folder, e),
    guard: (_job, phase) => onGuard(phase),
    security: (job, text) => {
      console.log(`  [${job.id} ${job.label}] ${text}`);
      orb?.send({ type: "activity", text: `${job.label}: ${text}`, glyph: "eye" });
    },
    finished: (job) => {
      addLine(job, "end", job.status === "done" ? "Finished." : job.status === "stopped" ? "Stopped." : `Failed${job.lastText ? `: ${job.lastText.slice(0, 300)}` : "."}`);
      const first = job.lastText.split(/(?<=[.!?])\s/)[0]?.slice(0, 220) ?? "";
      const what =
        job.status === "done"
          ? `The ${job.label} session has finished`
          : job.status === "stopped"
            ? `I stopped the ${job.label} session`
            : `The ${job.label} session ran into a problem`;
      console.log(`\n  [${job.id} ${job.label}] ${job.status} · $${job.costUsd.toFixed(3)}\n${job.lastText}\n`);
      // A question it couldn't put to Dan: say so, so it isn't lost in the report.
      const asked = job.unanswered.length
        ? ` It had ${job.unanswered.length === 1 ? "a question" : `${job.unanswered.length} questions`} for you that I couldn't put on screen: ${job.unanswered.join(" ")}`
        : "";
      if (asked) console.log(`  [${job.id} ${job.label}] unanswered: ${job.unanswered.join(" | ")}`);
      void say(`${first ? `${what}. ${first}` : `${what}.`}${asked}`);
      tidyWindows();
      restartIfDue();
    },
  }, undefined, () => settings.backgroundPermissionMode);

  /** A session with its status corrected by her own runs (see liveStatus). */
  const live = (s: SessionSummary): SessionSummary => ({ ...s, status: liveStatus(s, sessionRunner.list()) });
  const liveSessions = async (opts: Parameters<typeof listSessions>[0]) => (await listSessions(opts)).map(live);

  const knownFolders = async () => [...new Set((await listSessions({ limit: 200 })).map((s) => s.folder))];

  /** A session by id, title or project, or one of the background runs ("s1"). */
  const sessionRef = async (ref: string): Promise<SessionSummary> => {
    const job = sessionRunner.get(ref);
    if (job?.sessionId) {
      return (
        (await findSession(job.sessionId)) ?? {
          id: job.sessionId,
          title: job.prompt.slice(0, 60),
          project: job.label,
          folder: job.folder,
          status: job.status === "running" ? "working" : "waiting",
          lastActivity: job.startedAt,
          source: "sdk-ts",
          lastReply: job.lastText,
          lastPrompt: job.prompt,
        }
      );
    }
    const s = await findSession(ref);
    if (!s) throw new Error(`I couldn't find a session matching "${ref}".`);
    return s;
  };

  /** The sit rep: every recent session and background run, on screen; returns the short spoken version. */
  const showSitrep = async (): Promise<string> => {
    const runs = sessionRunner.list().map((j) => ({ handle: j.id, label: j.label, status: j.status, latest: j.lastText }));
    const report = sitrep(await liveSessions({ limit: 30, exclude: [cfg.workspaceDir] }), runs);
    if (orb?.alive) showPanel({ type: "detail", title: "Sit rep", html: renderDetail(report.markdown) });
    else console.log(`\n${report.markdown}\n`);
    return report.spoken;
  };

  // ── The Tallyline panel: Dan's work ledger at a glance, live while it's open; it expands to the full app ──
  const tallyline = new Tallyline(path.join(cfg.workspaceDir, "tallyline"), path.join(cfg.home, "logs", "tallyline.log"));
  let tallylineOpen = false;
  let tallylineTimer: NodeJS.Timeout | undefined;
  /** Sends the panel Tallyline's summary (or why it can't). `owner: "user"` opens it; otherwise it only updates. */
  const refreshTallyline = async (owner?: "user") => {
    if (owner) tallylineOpen = true;
    if (!tallylineOpen || !orb?.alive) return;
    try {
      orb.send({ type: "tallyline", summary: await tallyline.summary(), ...(owner ? { owner } : {}) });
    } catch (err) {
      orb.send({ type: "tallyline", error: `Tallyline isn't answering (${(err as Error).message}).`, ...(owner ? { owner } : {}) });
    }
    clearInterval(tallylineTimer);
    tallylineTimer = setInterval(() => void refreshTallyline(), 20_000);
    tallylineTimer.unref();
  };
  /** ui_control show_tallyline: open the panel, starting Tallyline first if it isn't running; failures are shown. */
  const showTallyline = async (): Promise<string> => {
    if (!orb?.alive) return "No orb is open.";
    remember("tallyline", "Tallyline", () => void showTallyline(), "tallyline");
    tallylineOpen = true;
    if (!(await tallyline.up())) {
      orb.send({ type: "tallyline", starting: true, owner: "user" });
      try {
        await tallyline.ensureRunning();
      } catch (err) {
        const why = (err as Error).message;
        console.log(`  [tallyline] ${why}`);
        orb.send({ type: "tallyline", error: `I couldn't start Tallyline. ${why}` });
        return `I couldn't start Tallyline: ${why}`;
      }
    }
    await refreshTallyline("user");
    return tallyline.ownsServer ? "Started Tallyline and opened its panel." : "Showing Tallyline.";
  };

  // ── The open sessions panel: live while it's open, refreshed by run events (and gently every 20 s for app sessions) ──
  let sessionsPanelOpen = false;
  let sessionsOrder: string[] = [];
  let sessionsTimer: NodeJS.Timeout | undefined;
  let sessionsSoon: NodeJS.Timeout | undefined;
  /** Sends the panel a fresh list. `owner: "user"` opens it (an explicit show); otherwise it only updates an open one. */
  const refreshSessions = async (owner?: "user", note?: string) => {
    if (owner) sessionsPanelOpen = true;
    if (!sessionsPanelOpen || !orb?.alive) return;
    const list = await liveSessions({ limit: 30, exclude: [cfg.workspaceDir] }).catch(() => [] as SessionSummary[]);
    // An explicit show starts a fresh order; refreshes keep rows where they were (see orderRows).
    const view = buildSessionsView(list, sessionRunner.list(), Date.now(), runPhases, owner ? [] : sessionsOrder);
    sessionsOrder = [...view.open, ...view.recent].map((r) => r.key);
    orb.send({ type: "sessions", ...view, ...(owner ? { owner } : {}), ...(note ? { note } : {}) });
    clearInterval(sessionsTimer);
    sessionsTimer = setInterval(() => void refreshSessions(), 20_000);
    sessionsTimer.unref();
  };
  /** A run did something: refresh once things settle, at most once a second. */
  const sessionsChanged = () => {
    if (!sessionsPanelOpen || sessionsSoon) return;
    sessionsSoon = setTimeout(() => {
      sessionsSoon = undefined;
      void refreshSessions();
    }, 1000);
  };
  /** A button in the panel: the same session tools (and checks) as asking by voice. */
  const onSessionAction = async ({ action, ref, run, text }: { action: SessionAction; ref: string; run?: string; text?: string }) => {
    let note: string;
    try {
      if (action === "open") note = await sessions.open(ref);
      else if (action === "message") note = text ? await sessions.send(ref, text) : "Type a message first.";
      else if (action === "transcript") {
        const job = run ? sessionRunner.list().find((j) => j.id === run) : undefined;
        if (job) showTranscript(job as Job, "user");
        note = job ? `Showing ${job.id}'s transcript.` : "That run's transcript isn't here any more.";
      } else {
        if (!run) return;
        const answer = orb?.alive
          ? await orb.question({ question: `Stop background run ${run}?`, options: [{ label: "Stop it" }, { label: "Keep it running" }], multiSelect: false, allowOther: false }, new AbortController().signal)
          : null;
        note = (Array.isArray(answer) ? answer[0] : answer) === "Stop it" ? sessions.stop(run) : `Left ${run} running.`;
      }
    } catch (err) {
      note = (err as Error).message;
    }
    console.log(`  [sessions] ${note}`);
    await refreshSessions(undefined, note);
  };

  // God mode: she commands your sessions (see GOD_MODE) and every 30 s checks which have finished a turn.
  const seen = new Map<string, SessionSummary["status"]>();
  let godTimer: NodeJS.Timeout | null = null;
  const watchSessions = async () => {
    const now = await liveSessions({ limit: 30, exclude: [cfg.workspaceDir] }).catch(() => [] as SessionSummary[]);
    const first = seen.size === 0;
    const finished = first ? [] : newlyWaiting(seen, now);
    seen.clear();
    for (const s of now) seen.set(s.id, s.status);
    // Her own background runs are reported when they end anyway.
    const mine = new Set(sessionRunner.list().map((j) => j.sessionId));
    const titles = finished.filter((s) => !mine.has(s.id)).map((s) => s.title);
    if (!titles.length) return;
    const text = titles.length === 1 ? `${titles[0]} has finished and is waiting on you.` : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)} have finished and are waiting on you.`;
    if (transcribing) console.log(`\n  (${text})`);
    else void say(text);
  };
  /** God mode on or off: commanding your sessions, with finish announcements. Remembered between runs. */
  const setGodMode = (on: boolean): string => {
    settings.godMode = on;
    saveSettings(cfg.home, settings);
    if (godTimer) clearInterval(godTimer);
    godTimer = null;
    seen.clear();
    if (on) {
      void watchSessions();
      godTimer = setInterval(() => void watchSessions(), 30_000);
      godTimer.unref();
    }
    sendMode();
    return on
      ? "God mode on. I'll hand project work to your sessions, tell you when one finishes, and say \"sit rep\" any time for where everything's at."
      : "God mode off. I'll do the work myself again.";
  };
  if (settings.godMode) setGodMode(true);

  const sessions: SessionTools = {
    list: async (project, includeAstra) => ({
      sessions: (await liveSessions({ limit: 12, project, exclude: includeAstra ? [] : [cfg.workspaceDir] })).map((s) => ({
        id: s.id,
        title: s.title,
        project: s.project,
        status: s.status,
        lastActivity: s.lastActivity,
        inApp: s.source === "claude-desktop",
        ...(s.permissionMode ? { mode: s.permissionMode } : {}),
        lastReply: s.lastReply.slice(0, 300),
      })),
      backgroundRuns: sessionRunner.list().map((j) => ({
        handle: j.id,
        project: j.label,
        status: j.status,
        session: j.sessionId,
        latest: j.lastText.slice(0, 200),
        mode: j.permissionMode,
      })),
    }),
    read: async (ref) => {
      const s = live(await sessionRef(ref));
      return {
        title: s.title,
        project: s.project,
        status: s.status,
        lastActivity: s.lastActivity,
        lastPrompt: s.lastPrompt.slice(0, 6000),
        lastReply: s.lastReply.slice(0, 6000),
      };
    },
    send: async (ref, prompt) => {
      const s = live(await sessionRef(ref));
      if (s.status === "working") throw new Error(`"${s.title}" is working right now; I only send to a session when it's idle.`);
      const job = sessionRunner.send(s.id, s.folder || cfg.workspaceDir, prompt, s.project);
      console.log(`  [${job.id} ${job.label}] resumed ${s.id} with ${job.permissionMode} permissions`);
      startTranscript(job);
      return `Sent to "${s.title}" (${s.project}) as background run ${job.id}. You'll hear when it's done, and its approvals will come to you.`;
    },
    start: async (project, prompt, where) => {
      const folder = await resolveProject(project, await knownFolders());
      if (!folder) throw new Error(`I couldn't find a project called "${project}".`);
      if (where === "app") {
        await realRunner.run("open", [appLinks.newSession(folder, prompt)]);
        // Verified: the app sends a new session's prompt by itself and runs it there (entrypoint claude-desktop).
        return `Started a new session in ${path.basename(folder)} in the Claude app; it's running there now, so you can watch it.`;
      }
      const job = sessionRunner.start(folder, prompt, path.basename(folder));
      console.log(`  [${job.id} ${job.label}] started in ${folder} with ${job.permissionMode} permissions`);
      startTranscript(job);
      return `Started background run ${job.id} in ${path.basename(folder)}. You'll hear when it's done, and its approvals will come to you.`;
    },
    open: async (ref) => {
      const s = await sessionRef(ref);
      await realRunner.run("open", [appLinks.open(s)]);
      return `Opened "${s.title}" in the Claude app.`;
    },
    stop: (handle) => (sessionRunner.stop(handle) ? `Stopping ${handle}.` : `There's no running background session called ${handle}.`),
  };

  /** Bringing back windows she showed recently (the show_window tool and "show me your windows"). */
  const windowTools: WindowTools = {
    show: async (which) => {
      const ask = which?.trim() ?? "";
      if (!ask || /^(list|which|what)$/i.test(ask)) return `Windows I've shown recently, newest first:\n${windows.describe()}`;
      if (/^(all|everything|recent|latest|last|them|those)$/i.test(ask)) {
        const latest = windows.latest();
        if (!latest.length) return "I haven't shown any windows yet.";
        for (const e of latest) await e.reopen();
        return `Brought back ${latest.map((e) => e.title).join(", ")}.`;
      }
      const match = windows.find(ask);
      if (!match) return `Nothing I've shown recently matches "${ask}". Recent windows:\n${windows.describe()}`;
      await match.reopen();
      return `Showing ${match.title} again.`;
    },
  };

  // Coffee mode: the Mac stays awake. Picked back up after a restart; the orb hears every change.
  const coffee = new CoffeeMode(path.join(cfg.home, "coffee.json"));
  coffee.onChange = (on, until) => orb?.send({ type: "coffee", on, until });
  if (coffee.resume()) console.log(`  ☀︎ ${coffee.status()}`);

  const jarvis = new Jarvis(cfg, {
    say,
    sessions,
    windows: windowTools,
    computer,
    coffee,
    toolEvent: (e) => onToolEvent("Astra", cfg.workspaceDir, e),
    graph: (title, graph) => {
      if (orb?.alive) {
        showPanel({ type: "graph", title, graph });
        return "Shown as a 3D map. The user can orbit it and click nodes for detail.";
      }
      console.log(`\n${graphAsText(title, graph)}\n`);
      return "Printed as text in the terminal (no orb is open).";
    },
    show: (title, markdown) => {
      if (orb?.alive) {
        showPanel({ type: "detail", title, html: renderDetail(markdown) });
        return "Shown in the detail panel.";
      }
      console.log(`\n── ${title} ──\n${markdown}\n`);
      return "Printed in the terminal (no orb is open).";
    },
    // The terminal gets the technical line; the orb gets plain English ("Searching your brain…").
    guard: onGuard,
    status: (text, input) => {
      console.log(`  ${text}`);
      const tool = text.match(/^→ (\S+)/)?.[1];
      const friendly = tool ? describeActivity(tool, input) : text === "… thinking" ? "Thinking…" : text;
      orb?.send({ type: "activity", text: friendly, glyph: tool ? activityGlyph(tool) : "sun" });
    },
    ask: (approval) => askApproval(approval),
    // ask_user: a question card with options, answerable by voice, click or typing.
    question: (spec) => askQuestion(spec),
    // ui_control: Astra working her own interface (panels, minimise, stop).
    ui: (action, level, position) => runUi({ action, level, position }),
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
    // A quit or restart asked for while she was listening: its injected "/quit" can be taken as the Enter that ends
    // the recording and never reach here, which left her running after promising a restart. The flag can't be lost.
    if (quitting) break;
    if (pendingTranscript && !busy) {
      const { title } = pendingTranscript;
      pendingTranscript = null;
      await runTranscript(title);
      continue;
    }
    let request = input.trim();
    if (!request) continue;
    // Commands are recognised here, however they arrived and however they're phrased, before anything reaches Claude.
    const local = localCommand(request);
    if (local && "slash" in local) {
      announceLocal(local.slash);
      request = local.slash;
    }

    if (request === "/quit" || request === "/exit") break;
    if (request === "/help") { console.log(HELP); continue; }
    if (request === "/brain") { console.log(`  ${await openBrain()}`); continue; }
    if (request === "/restart") { console.log(`  ${requestRestart()}`); continue; }
    if (request === "/stack") { console.log(`  ${await runUi("stack_windows")}`); continue; }
    if (request === "/sitrep") { console.log(`  ${await runUi("sitrep")}`); continue; }
    if (request === "/god on" || request === "/god off") { console.log(`  ${setGodMode(request === "/god on")}`); continue; }
    if (request === "/type" || request === "/voice") { console.log(`  ${setTypeOnly(request === "/type")}`); continue; }
    if (/^\/transcript\b/.test(request)) {
      await runTranscript(request.slice(11).trim() || undefined);
      followUp = !muted && lastInputWasVoice;
      continue;
    }
    if (local && "ui" in local) {
      announceLocal(local.ui);
      console.log(`  ${await runUi(local.ui)}`);
      continue;
    }
    if (request === "/continue") { await continueLast(); continue; }
    if (request === "/new") { jarvis.reset(); console.log("Fresh conversation. Your brain notes are kept."); continue; }
    if (request === "/mute") { muted = true; speaker.stop(); continue; }
    if (request === "/unmute") { muted = false; continue; }
    if (request === "/wake off" || request === "/wake on") {
      wakeOn = request === "/wake on";
      console.log(wakeOn ? 'Say "Astra" to wake me.' : "Wake word off: press Enter or click the orb to talk.");
      continue;
    }

    busy = true;
    computer.resume();
    requestCount++;
    syncOrb();
    orb?.send({ type: "activity-reset" });
    orb?.send({ type: "activity", text: "Thinking…", glyph: "sun" });
    try {
      const spoken = lastInputWasVoice;
      // Just after a transcript, tell her where it is, so "summarise that" or "action items" find it.
      const context =
        (settings.godMode ? GOD_MODE : "") +
        (lastTranscript ? `(I just recorded a transcript; it's in your brain at ${lastTranscript}.)\n\n` : "");
      lastTranscript = null;
      const result = await jarvis.handle(context + request);
      rememberSession();
      console.log(`  (${result.ok ? "done" : result.summary} · $${result.costUsd.toFixed(3)})`);
      followUp = spoken && result.ok && !muted;
    } catch (err) {
      await say(`That failed: ${(err as Error).message}`);
    } finally {
      busy = false;
      syncOrb();
      // A stopped request never reports its last results: clear her own transfers so the orb doesn't keep beaming.
      for (const [id, t] of transfers) if (t.source === "Astra") transfers.delete(id);
      syncTransfer();
      tidyWindows();
    }
    restartIfDue();
    if (pendingContinue) {
      pendingContinue = false;
      await continueLast();
    }
    if (pendingTranscript) {
      const { title } = pendingTranscript;
      pendingTranscript = null;
      await runTranscript(title);
    }
  }

  quitting = true;
  await wakeListener.cancel();
  speaker.stop();
  // A restart (its flag file is there) keeps coffee mode for the next start; quitting ends it.
  coffee.shutdown(existsSync(path.join(cfg.home, "restart")));
  // A Tallyline server she started herself goes with her (one Dan started is left running).
  tallyline.stop();
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
