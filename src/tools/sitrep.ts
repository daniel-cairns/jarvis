/**
 * God mode's sit rep: what every recent Claude Code session and background run is doing, as a short spoken summary
 * and a markdown panel. Built straight from the session files, so it's instant and costs nothing.
 */
import type { SessionSummary } from "./sessions.js";

export type RunSummary = { handle: string; label: string; status: "running" | "done" | "failed" | "stopped"; latest: string };

/** Sessions older than this are left out of the sit rep. */
export const SITREP_WINDOW_MS = 24 * 3600_000;

const ago = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} h ago`;
};

const firstSentence = (text: string) => {
  const s = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);

/** "A, B and C", or the first three and "N more", so it stays quick to hear. */
const names = (items: string[]) => {
  const said = items.length > 3 ? [...items.slice(0, 3), `${word(items.length - 3)} more`] : items;
  return said.length <= 1 ? (said[0] ?? "") : `${said.slice(0, -1).join(", ")} and ${said.at(-1)}`;
};

const plural = (n: number, one: string, many: string) => {
  const w = word(n);
  return `${w[0]!.toUpperCase()}${w.slice(1)} ${n === 1 ? one : many}`;
};

export function sitrep(sessions: SessionSummary[], runs: RunSummary[], now = Date.now()): { spoken: string; markdown: string } {
  const recent = sessions.filter((s) => now - Date.parse(s.lastActivity) < SITREP_WINDOW_MS);
  const working = recent.filter((s) => s.status === "working");
  const waiting = recent.filter((s) => s.status === "waiting");
  const quiet = recent.filter((s) => s.status === "idle");
  const running = runs.filter((r) => r.status === "running");
  const ended = runs.filter((r) => r.status !== "running");

  const spoken: string[] = [];
  if (working.length) spoken.push(`${plural(working.length, "session is", "sessions are")} working: ${names(working.map((s) => s.title))}.`);
  if (waiting.length) spoken.push(`${plural(waiting.length, "is", "are")} waiting on you: ${names(waiting.map((s) => s.title))}.`);
  if (running.length) spoken.push(`I'm running ${names(running.map((r) => r.label))} in the background.`);
  const failed = ended.filter((r) => r.status === "failed");
  if (failed.length) spoken.push(`${names(failed.map((r) => r.label))} ran into a problem.`);
  if (!spoken.length) spoken.push("All quiet: nothing is working or waiting on you.");

  const line = (s: SessionSummary) => `- **${s.title}** · ${s.project} · ${ago(s.lastActivity, now)}${s.lastReply ? `\n  ${firstSentence(s.lastReply)}` : ""}`;
  const runLine = (r: RunSummary) => `- **${r.label}** (${r.handle}) · ${r.status}${r.latest ? `\n  ${firstSentence(r.latest)}` : ""}`;
  const sections: string[] = [];
  if (working.length) sections.push(`## ⚙️ Working\n\n${working.map(line).join("\n")}`);
  if (waiting.length) sections.push(`## ❓ Waiting on you\n\n${waiting.map(line).join("\n")}`);
  if (running.length || ended.length) sections.push(`## 𓂀 My background runs\n\n${[...running, ...ended].map(runLine).join("\n")}`);
  if (quiet.length) sections.push(`## 💤 Quiet today\n\n${quiet.map(line).join("\n")}`);
  const markdown = sections.length ? sections.join("\n\n") : "_No sessions in the last 24 hours._";
  return { spoken: spoken.join(" "), markdown };
}

/** Sessions that finished a turn since the last look (working → waiting): god mode tells you about these. */
export function newlyWaiting(before: Map<string, SessionSummary["status"]>, now: SessionSummary[]): SessionSummary[] {
  return now.filter((s) => s.status === "waiting" && before.get(s.id) === "working");
}

/** How long a session must be left waiting before god mode mentions it. */
export const ANNOUNCE_AFTER_MS = 2 * 60_000;

/**
 * God mode's ear on Dan's sessions: which ones have finished a turn and been left waiting a while. A session Dan is
 * in gets his reply within that time and is never announced (she used to announce the session he was sitting in,
 * every turn); one he has wandered away from is announced once, a couple of minutes after it finished.
 */
export class FinishWatcher {
  private readonly seen = new Map<string, { status: SessionSummary["status"]; waitingSince?: number; told?: boolean }>();
  private started = false;

  constructor(private readonly delayMs = ANNOUNCE_AFTER_MS) {}

  /** Takes the latest look at the sessions; returns the ones to announce now. */
  update(now: SessionSummary[], at = Date.now()): SessionSummary[] {
    const first = !this.started;
    this.started = true;
    const due: SessionSummary[] = [];
    const next = new Map<string, { status: SessionSummary["status"]; waitingSince?: number; told?: boolean }>();
    for (const s of now) {
      const before = this.seen.get(s.id);
      let entry: { status: SessionSummary["status"]; waitingSince?: number; told?: boolean } = { status: s.status };
      if (s.status === "waiting") {
        // Just finished (it was working last time we looked): start the clock. Already waiting: keep its clock.
        if (!first && before?.status === "working") entry = { status: s.status, waitingSince: at };
        else if (before?.status === "waiting") entry = { ...before };
      }
      if (entry.waitingSince !== undefined && !entry.told && at - entry.waitingSince >= this.delayMs) {
        entry.told = true;
        due.push(s);
      }
      next.set(s.id, entry);
    }
    this.seen.clear();
    for (const [id, e] of next) this.seen.set(id, e);
    return due;
  }

  reset(): void {
    this.seen.clear();
    this.started = false;
  }
}
