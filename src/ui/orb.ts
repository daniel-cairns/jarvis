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

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export type ToOrb =
  | { type: "state"; state: OrbState }
  | { type: "utterance"; text: string; envelope: number[]; frameMs: number }
  | { type: "caption"; role: "jarvis" | "you" | "status"; text: string }
  | { type: "ask"; id: string; spoken: string; detail: string }
  | { type: "answered"; id: string }
  | { type: "quit" };

export type FromOrb = { type: "ready" } | { type: "talk" } | { type: "answer"; id: string; answer: Answer };

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
  if (msg.type === "ready" || msg.type === "talk") return { type: msg.type };
  if (msg.type === "answer" && typeof msg.id === "string" && typeof msg.answer === "string" && ANSWERS.has(msg.answer)) {
    return { type: "answer", id: msg.id, answer: msg.answer as Answer };
  }
  return null;
}

export const ORB_MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../orb/main.cjs");

export class Orb {
  private readonly pending = new Map<string, (answer: Answer | null) => void>();
  private seq = 0;
  private exited = false;

  constructor(
    private readonly child: ChildProcess,
    private readonly onTalk: () => void,
  ) {
    readline.createInterface({ input: child.stdout! }).on("line", (line) => this.receive(parseFromOrb(line)));
    child.on("exit", () => this.markGone());
    child.on("error", () => this.markGone());
    child.stdin?.on("error", () => this.markGone());
  }

  /** Starts the orb window. Returns null if Electron isn't installed. */
  static launch(onTalk: () => void, electronBin?: string): Orb | null {
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
    return new Orb(child, onTalk);
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
      this.send({ type: "ask", id, spoken, detail });
    });
  }

  close(): void {
    this.send({ type: "quit" });
    this.child.stdin?.end();
  }

  private receive(msg: FromOrb | null): void {
    if (msg?.type === "talk") this.onTalk();
    else if (msg?.type === "answer") {
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
