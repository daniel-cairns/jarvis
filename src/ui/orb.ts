import type { SessionsView } from "./sessionsPanel.js";
/**
 * Talks to the orb window (orb/main.cjs, run by Electron) over JSON lines on stdin/stdout.
 * If Electron can't start, `alive` stays false and Astra falls back to the terminal and the pop-up.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { Answer } from "../permissions.js";
import type { Choice, QuestionAnswer, QuestionSpec } from "../voice/answers.js";
import type { ActivityGlyph } from "../activity.js";
import type { BrainEntry } from "../tools/brain.js";
import type { RepoState } from "../tools/git.js";
import type { TermEntry } from "./worklog.js";
import type { Position, UiAction } from "./control.js";
import type { TeardownGraph } from "./graph.js";

/** What the sessions panel can do with a row. */
export const SESSION_ACTIONS = ["open", "message", "stop", "transcript"] as const;
export type SessionAction = (typeof SESSION_ACTIONS)[number];

/** A background run's state, shown as a row of ring glyphs in its transcript (orb/runes.js). */
export type RunPhase =
  | { phase: "thinking" | "waiting" | "done" | "failed" | "stopped" }
  | { phase: "tool"; glyph: ActivityGlyph };

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export type ToOrb =
  | { type: "state"; state: OrbState }
  | { type: "utterance"; text: string; envelope: number[]; frameMs: number }
  | { type: "caption"; role: "jarvis" | "you" | "status"; text: string }
  /** The "Astra is controlling your Mac" indicator (src/control/computer.ts). */
  | { type: "control"; on: boolean }
  | { type: "ask"; id: string; spoken: string; detail: string }
  | { type: "answered"; id: string }
  | { type: "detail"; title: string; html: string; follow?: boolean; owner?: "user" }
  | { type: "request-done" }
  | { type: "state-label"; text: string }
  | { type: "recording"; on: boolean }
  | { type: "mode"; typeOnly: boolean; god: boolean }
  | { type: "transfer"; dir: "up" | "down" | null }
  | { type: "guard"; state: "checking" | "blocked" | null }
  | {
      type: "transcript";
      job: { id: string; label: string; status: string };
      lines: { kind: "prompt" | "text" | "tool" | "end"; text: string }[];
      /** What the run is doing, for the transcript's glyph row. */
      state?: RunPhase;
      owner?: "user";
    }
  | { type: "graph"; title: string; graph: TeardownGraph; owner?: "user" }
  | { type: "question"; id: string; question: string; options: Choice[]; multiSelect: boolean; allowOther: boolean }
  | { type: "activity"; text: string; glyph?: ActivityGlyph }
  | { type: "activity-reset" }
  | { type: "ui"; action: UiAction; position?: Position }
  | { type: "volume-level"; level: number; quiet?: boolean }
  | { type: "brain"; notes: BrainEntry[]; owner?: "user" }
  | { type: "terminal"; entries: TermEntry[]; force?: boolean; owner?: "user" }
  | { type: "git"; repos: RepoState[]; force?: boolean; owner?: "user" }
  | { type: "git-diff-result"; root: string; path: string; diff: string }
  | { type: "coffee"; on: boolean; until: number | null }
  | ({ type: "sessions"; owner?: "user"; note?: string } & SessionsView)
  | { type: "brain-note"; path: string; title: string; html: string; hasMap: boolean }
  | { type: "quit" };

export type FromOrb =
  | { type: "ready" }
  | { type: "talk" }
  | { type: "stop" }
  | { type: "restart" }
  | { type: "continue-session" }
  | { type: "record" }
  | { type: "type-only"; on: boolean }
  | { type: "typed"; text: string }
  | { type: "quit" }
  | { type: "answer"; id: string; answer: Answer }
  | { type: "question-answer"; id: string; answer: QuestionAnswer }
  | { type: "brain-request" }
  | { type: "brain-open" | "brain-map"; path: string }
  | { type: "volume"; delta?: number; level?: number }
  | { type: "git-diff"; root: string; path: string }
  | { type: "panel-closed" | "panel-opened"; kind: string }
  | { type: "session-action"; action: SessionAction; ref: string; run?: string; text?: string };

export type OrbHandlers = {
  onTalk(): void;
  onStop(): void;
  /** The record glyph: start a transcript, or stop the one running. */
  onRecord?(): void;
  /** The mouth glyph: type-only mode (mic off, silent) on or off. */
  onTypeOnly?(on: boolean): void;
  /** A line typed in the orb's type box: handled exactly like one typed in the terminal. */
  onTyped?(text: string): void;
  onQuit(): void;
  /** "Restart Astra" from the menu bar. */
  onRestart?(): void;
  /** "Continue last session" from the menu bar. */
  onContinue?(): void;
  /** The brain browser asked for its note list, one note, or a note's map. */
  onBrain?(msg: Extract<FromOrb, { type: "brain-request" | "brain-open" | "brain-map" }>): void;
  /** The git panel asked for one file's diff. */
  onGitDiff?(msg: { root: string; path: string }): void;
  onPanelClosed?(kind: string): void;
  onPanelOpened?(kind: string): void;
  onSessionAction?(msg: { action: SessionAction; ref: string; run?: string; text?: string }): void;
  /** Scroll on the orb (delta) or the menu-bar volume menu (level), both 0..1 scale. */
  onVolume?(msg: { delta?: number; level?: number }): void;
};

const ANSWERS = new Set<string>(["yes", "always", "no"]);

/** Parses one line from the orb process; anything unexpected (including Chromium noise) is ignored. */
export function parseFromOrb(line: string): FromOrb | null {
  let m: unknown;
  try {
    m = JSON.parse(line);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const msg = m as Record<string, unknown>;
  if (msg.type === "ready" || msg.type === "talk" || msg.type === "stop" || msg.type === "record" || msg.type === "restart" || msg.type === "continue-session" || msg.type === "quit" || msg.type === "brain-request") {
    return { type: msg.type };
  }
  if (msg.type === "type-only" && typeof msg.on === "boolean") return { type: "type-only", on: msg.on };
  if (msg.type === "typed" && typeof msg.text === "string" && msg.text.trim() && msg.text.length <= 2000) return { type: "typed", text: msg.text };
  if ((msg.type === "brain-open" || msg.type === "brain-map") && typeof msg.path === "string" && msg.path.length <= 300) {
    return { type: msg.type, path: msg.path };
  }
  if ((msg.type === "panel-closed" || msg.type === "panel-opened") && typeof msg.kind === "string" && msg.kind.length < 40) {
    return { type: msg.type, kind: msg.kind };
  }
  if (
    msg.type === "session-action" &&
    typeof msg.action === "string" &&
    (SESSION_ACTIONS as readonly string[]).includes(msg.action) &&
    typeof msg.ref === "string" &&
    msg.ref.length < 200 &&
    (msg.run === undefined || (typeof msg.run === "string" && /^s\d{1,4}$/.test(msg.run))) &&
    (msg.text === undefined || (typeof msg.text === "string" && msg.text.trim().length > 0 && msg.text.length <= 4000))
  ) {
    return { type: "session-action", action: msg.action as SessionAction, ref: msg.ref, run: msg.run as string | undefined, text: msg.text as string | undefined };
  }
  if (msg.type === "git-diff" && typeof msg.root === "string" && typeof msg.path === "string" && msg.root.length < 500 && msg.path.length < 500) {
    return { type: "git-diff", root: msg.root, path: msg.path };
  }
  if (msg.type === "volume") {
    const delta = typeof msg.delta === "number" && Math.abs(msg.delta) <= 0.25 ? msg.delta : undefined;
    const level = typeof msg.level === "number" && msg.level >= 0 && msg.level <= 1 ? msg.level : undefined;
    if (delta !== undefined || level !== undefined) return { type: "volume", delta, level };
  }
  if (msg.type === "answer" && typeof msg.id === "string" && typeof msg.answer === "string" && ANSWERS.has(msg.answer)) {
    return { type: "answer", id: msg.id, answer: msg.answer as Answer };
  }
  if (msg.type === "question-answer" && typeof msg.id === "string") {
    const a = msg.answer;
    const labels = Array.isArray(a) && a.length <= 8 && a.every((x) => typeof x === "string" && x.length <= 200);
    const text = typeof a === "string" && a.trim().length > 0 && a.length <= 2000;
    if (labels || text) return { type: "question-answer", id: msg.id, answer: a as QuestionAnswer };
  }
  return null;
}

export const ORB_MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../orb/main.cjs");

export class Orb {
  private readonly pending = new Map<string, (answer: Answer | QuestionAnswer | null) => void>();
  private seq = 0;
  private exited = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly handlers: OrbHandlers,
  ) {
    readline.createInterface({ input: child.stdout! }).on("line", (line) => this.receive(parseFromOrb(line)));
    child.on("exit", () => this.markGone());
    child.on("error", () => this.markGone());
    child.stdin?.on("error", () => this.markGone());
  }

  /** Starts the orb window. Returns null if Electron isn't installed. */
  static launch(handlers: OrbHandlers, electronBin?: string): Orb | null {
    let bin = electronBin;
    if (!bin) {
      try {
        // In Node, the electron package's main export is the path to its binary.
        bin = createRequire(import.meta.url)("electron") as string;
      } catch {
        return null;
      }
    }
    const child = spawn(bin, [ORB_MAIN], { stdio: ["pipe", "pipe", "ignore"] });
    return new Orb(child, handlers);
  }

  get alive(): boolean {
    return !this.exited;
  }

  send(msg: ToOrb): void {
    if (this.exited) return;
    this.child.stdin?.write(`${JSON.stringify(msg)}\n`);
  }

  /** Shows the approval card. Resolves null if aborted or the orb goes away. */
  ask(spoken: string, detail: string, signal: AbortSignal): Promise<Answer | null> {
    return this.cardAnswer(signal, (id) => ({ type: "ask", id, spoken, detail })) as Promise<Answer | null>;
  }

  /** Shows a question card with options. Resolves with the chosen labels or typed text; null if aborted. */
  question(spec: QuestionSpec, signal: AbortSignal): Promise<QuestionAnswer | null> {
    return this.cardAnswer(signal, (id) => ({ type: "question", id, ...spec })) as Promise<QuestionAnswer | null>;
  }

  /** Shows a card and waits for its answer; withdraws the card if the signal aborts. */
  private cardAnswer(signal: AbortSignal, card: (id: string) => ToOrb): Promise<Answer | QuestionAnswer | null> {
    if (this.exited || signal.aborted) return Promise.resolve(null);
    const id = String(++this.seq);
    return new Promise((resolve) => {
      const onAbort = () => {
        this.pending.delete(id);
        this.send({ type: "answered", id });
        resolve(null);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, (answer) => {
        signal.removeEventListener("abort", onAbort);
        resolve(answer);
      });
      this.send(card(id));
    });
  }

  close(): void {
    this.send({ type: "quit" });
    this.child.stdin?.end();
  }

  private receive(msg: FromOrb | null): void {
    if (msg?.type === "talk") this.handlers.onTalk();
    else if (msg?.type === "stop") this.handlers.onStop();
    else if (msg?.type === "record") this.handlers.onRecord?.();
    else if (msg?.type === "type-only") this.handlers.onTypeOnly?.(msg.on);
    else if (msg?.type === "typed") this.handlers.onTyped?.(msg.text);
    else if (msg?.type === "quit") this.handlers.onQuit();
    else if (msg?.type === "restart") this.handlers.onRestart?.();
    else if (msg?.type === "continue-session") this.handlers.onContinue?.();
    else if (msg?.type === "brain-request" || msg?.type === "brain-open" || msg?.type === "brain-map") this.handlers.onBrain?.(msg);
    else if (msg?.type === "volume") this.handlers.onVolume?.(msg);
    else if (msg?.type === "git-diff") this.handlers.onGitDiff?.(msg);
    else if (msg?.type === "panel-closed") this.handlers.onPanelClosed?.(msg.kind);
    else if (msg?.type === "panel-opened") this.handlers.onPanelOpened?.(msg.kind);
    else if (msg?.type === "session-action") this.handlers.onSessionAction?.(msg);
    else if (msg?.type === "answer" || msg?.type === "question-answer") {
      const resolve = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      resolve?.(msg.answer);
    }
  }

  private markGone(): void {
    this.exited = true;
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }
}
