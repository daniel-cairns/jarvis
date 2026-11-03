/**
 * Open loops: what's waiting, for Dan or on him. Decisions put to him on cards, background runs in flight, and things
 * he said to do later. Cards and runs open and close their own loops, so an answered question is closed and can't
 * come back; she adds "later" items herself. Kept in ~/.jarvis/loops.json, so they outlive a restart.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LoopKind = "decision" | "run" | "later";

export type Loop = {
  id: string;
  kind: LoopKind;
  /** What's waiting, in a few words ("Add Start epic to Quench?"). */
  text: string;
  /** Who it's from or for: a session's name, a project. */
  source?: string;
  openedAt: string;
  closedAt?: string;
  /** How it ended: Dan's answer, a run's status. */
  outcome?: string;
};

const FILE = "loops.json";
/** Closed loops are kept this long, so "what did I decide about…" can still be answered. */
const KEEP_CLOSED_MS = 7 * 24 * 60 * 60_000;

export class Loops {
  private readonly file: string;

  constructor(home: string, private readonly now = () => new Date()) {
    this.file = path.join(home, FILE);
  }

  /** Every loop on file (read fresh, so her tools and the host share one list). */
  all(): Loop[] {
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      return Array.isArray(data) ? (data as Loop[]) : [];
    } catch {
      return [];
    }
  }

  /** The loops still open, oldest first. */
  open(): Loop[] {
    return this.all().filter((l) => !l.closedAt);
  }

  /** Opens a loop and returns it. */
  add(kind: LoopKind, text: string, source?: string): Loop {
    const loops = this.all();
    const next = loops.reduce((n, l) => Math.max(n, Number(l.id.slice(1)) || 0), 0) + 1;
    const loop: Loop = { id: `l${next}`, kind, text: text.slice(0, 300), ...(source ? { source } : {}), openedAt: this.now().toISOString() };
    this.save([...loops, loop]);
    return loop;
  }

  /** Closes a loop with how it ended; false if it isn't open. */
  close(id: string, outcome: string): boolean {
    const loops = this.all();
    const loop = loops.find((l) => l.id === id && !l.closedAt);
    if (!loop) return false;
    loop.closedAt = this.now().toISOString();
    loop.outcome = outcome.slice(0, 300);
    this.save(loops);
    return true;
  }

  /** Closes every open loop that matches, e.g. runs that a restart ended; returns how many. */
  closeWhere(match: (l: Loop) => boolean, outcome: string): number {
    const loops = this.all();
    const at = this.now().toISOString();
    let n = 0;
    for (const l of loops) {
      if (l.closedAt || !match(l)) continue;
      l.closedAt = at;
      l.outcome = outcome;
      n++;
    }
    if (n) this.save(loops);
    return n;
  }

  private save(loops: Loop[]): void {
    const cutoff = this.now().getTime() - KEEP_CLOSED_MS;
    const kept = loops.filter((l) => !l.closedAt || Date.parse(l.closedAt) >= cutoff);
    mkdirSync(path.dirname(this.file), { recursive: true });
    // Written whole then renamed, so a crash mid-write never leaves half a file.
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(kept, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}

const LABEL: Record<LoopKind, string> = { decision: "Waiting on your answer", run: "Running for you", later: "For later" };

/** The "On your plate" panel: open loops grouped by kind. */
export function plateMarkdown(open: readonly Loop[]): string {
  if (!open.length) return "Nothing's waiting on you.";
  return (Object.keys(LABEL) as LoopKind[])
    .filter((kind) => open.some((l) => l.kind === kind))
    .map((kind) => `## ${LABEL[kind]}\n${open.filter((l) => l.kind === kind).map((l) => `- ${l.text}${l.source ? ` (${l.source})` : ""}`).join("\n")}`)
    .join("\n\n");
}

/** One spoken line about what's open: what's waiting on Dan first. */
export function plateHeadline(open: readonly Loop[]): string {
  if (!open.length) return "Nothing's waiting on you.";
  const yours = open.filter((l) => l.kind !== "run");
  const runs = open.length - yours.length;
  const runPart = runs ? `${runs} run${runs === 1 ? "" : "s"} going` : "";
  if (!yours.length) return `Nothing's waiting on you; ${runPart}.`;
  const first = /[.?!]$/.test(yours[0]!.text) ? yours[0]!.text : `${yours[0]!.text}.`;
  const lead = yours.length === 1 ? `One thing for you: ${first}` : `${yours.length} things for you. First: ${first}`;
  return runPart ? `${lead} And ${runPart}.` : lead;
}

/** The open loops as context for her turn (newest ten), or "" when there are none. */
export function loopsContext(open: readonly Loop[]): string {
  if (!open.length) return "";
  const lines = open.slice(-10).map((l) => `- [${l.id}] ${l.kind}: ${l.text}${l.source ? ` (${l.source})` : ""}`);
  return `(Open loops, from your own records:\n${lines.join("\n")})\n\n`;
}
