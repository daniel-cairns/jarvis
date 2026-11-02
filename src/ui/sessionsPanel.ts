/**
 * The open sessions panel: Dan's Claude Code sessions and Astra's background runs as one live list. Pure: turns the
 * sessions_list data into rows (status, where it runs, what it's doing, which actions are allowed) for the panel.
 */
import type { SessionSummary } from "../tools/sessions.js";
import type { JobStatus } from "../tools/runner.js";
import type { RunPhase } from "./orb.js";

export type RowStatus = "waiting" | "working" | "idle" | "done" | "failed" | "stopped";

/** What the panel needs of a background run (a slice of runner.Job). */
export type RunView = { id: string; label: string; status: JobStatus; sessionId?: string; lastText: string; startedAt: string; endedAt?: string };

export type SessionRow = {
  /** Stable across refreshes, for keeping a row's expanded state and focus. */
  key: string;
  /** What the session tools take: a session id, or a run's handle ("s2"). */
  ref: string;
  /** A run's handle, for stop and its transcript. */
  run?: string;
  title: string;
  project: string;
  where: string;
  status: RowStatus;
  /** The status in words (the glyphs are decoration). */
  statusText: string;
  /** Drives the row's glyphs, in the transcript's rhythms. */
  state: RunPhase;
  at: number;
  /** One line of what it's doing or last said. */
  now: string;
  /** Its latest reply, for expanding the row. */
  reply: string;
  canOpen: boolean;
  canMessage: boolean;
  /** Why messaging is off, shown on the disabled control. */
  messageWhy?: string;
  canStop: boolean;
};

export type SessionsView = { open: SessionRow[]; recent: SessionRow[] };

/** Idle sessions touched within this long stay in the open list; older ones move to Recent. */
export const ACTIVE_MS = 30 * 60_000;
/** Recent goes back a day. */
export const RECENT_MS = 24 * 60 * 60_000;

const ORDER: Record<RowStatus, number> = { waiting: 0, working: 1, idle: 2, done: 3, failed: 3, stopped: 3 };

const STATUS_TEXT: Record<RowStatus, string> = {
  waiting: "Waiting on you",
  working: "Working",
  idle: "Idle",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const oneLine = (s: string, max = 140) => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Where a session runs, in plain words. */
export function whereLabel(source: string): string {
  if (source === "claude-desktop") return "Claude app";
  if (source === "cli") return "Terminal";
  return source && source !== "unknown" ? source : "Claude Code";
}

/** The glyph state for a status: the same rhythms as a run's transcript. */
export function phaseFor(status: RowStatus, live?: RunPhase): RunPhase {
  if (status === "working") return live && live.phase !== "done" ? live : { phase: "thinking" };
  if (status === "waiting") return { phase: "waiting" };
  if (status === "idle") return { phase: "stopped" };
  return { phase: status };
}

/** Messaging needs a session that isn't mid-turn: sending to a working one would talk over it. */
export function messageRule(status: RowStatus, hasSession: boolean): { canMessage: boolean; messageWhy?: string } {
  if (!hasSession) return { canMessage: false, messageWhy: "This run has no session to message yet." };
  if (status === "working") return { canMessage: false, messageWhy: "It's working; you can message it once it's idle." };
  return { canMessage: true };
}

/** Builds the panel's rows: open sessions and runs first (waiting, working, idle), then the last day's Recent. */
export function buildSessionsView(
  sessions: SessionSummary[],
  runs: RunView[],
  now = Date.now(),
  phases: ReadonlyMap<string, RunPhase> = new Map(),
): SessionsView {
  const rows: SessionRow[] = [];
  // A background run on a session is that session: show it once, as the run (it has the live detail).
  const runSessions = new Set(runs.filter((r) => r.status === "running" && r.sessionId).map((r) => r.sessionId));
  for (const s of sessions) {
    if (runSessions.has(s.id)) continue;
    const status: RowStatus = s.status;
    rows.push({
      key: `session:${s.id}`,
      ref: s.id,
      title: s.title || "Untitled session",
      project: s.project,
      where: whereLabel(s.source),
      status,
      statusText: STATUS_TEXT[status],
      state: phaseFor(status),
      at: Date.parse(s.lastActivity) || 0,
      now: oneLine(status === "waiting" || status === "idle" ? s.lastReply : s.lastReply || s.lastPrompt),
      reply: s.lastReply.slice(0, 4000),
      canOpen: true,
      ...messageRule(status, true),
      canStop: false,
    });
  }
  for (const r of runs) {
    const status: RowStatus = r.status === "running" ? "working" : r.status;
    const session = sessions.find((s) => s.id === r.sessionId);
    rows.push({
      key: `run:${r.id}`,
      ref: r.sessionId ?? r.id,
      run: r.id,
      title: session?.title || r.label,
      project: r.label,
      where: `Background run ${r.id}`,
      status,
      statusText: STATUS_TEXT[status],
      state: phaseFor(status, phases.get(r.id)),
      at: Date.parse(r.endedAt ?? "") || (session ? Date.parse(session.lastActivity) : 0) || Date.parse(r.startedAt) || 0,
      now: oneLine(r.lastText),
      reply: r.lastText.slice(0, 4000),
      canOpen: !!r.sessionId,
      ...messageRule(status, !!r.sessionId),
      canStop: r.status === "running",
    });
  }
  const open: SessionRow[] = [];
  const recent: SessionRow[] = [];
  for (const row of rows) {
    const age = now - row.at;
    if (row.status === "waiting" || row.status === "working" || (row.status === "idle" && age < ACTIVE_MS)) open.push(row);
    else if (age < RECENT_MS) recent.push(row);
  }
  open.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.at - a.at);
  recent.sort((a, b) => b.at - a.at);
  return { open, recent };
}

/** "Show my sessions" and its variants: opens the panel without a round trip to Claude. */
export function isShowSessions(words: string): boolean {
  return /^(show|open|bring up|pull up|display)( me)?( all)?( of)?( my| the| your)?( open| live| running| claude( code)?)? sessions( panel| list)?$|^(my|open) sessions$|^sessions panel$/.test(words);
}
