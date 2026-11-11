/**
 * God mode's indicator and glyph slate (orb/god.js): what Astra is commanding, as entries for the orb. Pure: turns the
 * sessions panel's rows and her open loops into one glyph each from a fixed set, plus the satellite that orbits her
 * for each commanded session.
 */
import type { Loop } from "../loops.js";
import type { SessionRow, SessionsView } from "./sessionsPanel.js";

/** The fixed glyph set (orb/god-glyphs.js draws them). Not every glyph has a source yet; the set stays as it is. */
export const GOD_GLYPHS = ["working", "idle", "waiting", "done", "failed", "teardown", "note", "background", "researching"] as const;
export type GodGlyph = (typeof GOD_GLYPHS)[number];

/** A satellite's look: bright pulse, dim, or amber. */
export type SatelliteState = "working" | "idle" | "waiting";

export type GodEntry = {
  /** Stable across updates, for spotting what's new. */
  key: string;
  /** What session-action "open" takes; absent when there's nothing to open in the app. */
  ref?: string;
  title: string;
  /** The row's status, or "decision" for a question waiting on Dan. */
  status: SessionRow["status"] | "decision";
  glyph: GodGlyph;
  /** The glyph's meaning in plain English: its accessible name and the head of its help text. */
  meaning: string;
  /** One line: what it's doing or last said. */
  summary: string;
  lastAction: string;
  /** What it needs from Dan; starts "Nothing" when it needs nothing. */
  needs: string;
  /** Latest activity, epoch ms. */
  at: number;
  /** Present for a commanded session: it orbits the orb as a satellite in this state. */
  satellite?: SatelliteState;
  /** Shown as a cartouche on the slate (the slate keeps to a handful). */
  onSlate: boolean;
};

export const MEANING: Record<GodGlyph, string> = {
  working: "Working",
  idle: "Idle",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
  teardown: "Tearing down",
  note: "Brain note saved",
  background: "Background run",
  researching: "Researching",
};

/** How many cartouches the slate shows. */
export const SLATE_MAX = 8;
/** A finished background run stays on the slate this long. */
export const FINISHED_RUN_MS = 2 * 60 * 60_000;

const NOTHING = "Nothing";

const oneLine = (s: string, max = 140) => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** One of Dan's sessions: its status is its glyph (working water, waiting eye, idle reed). */
function sessionEntry(row: SessionRow): GodEntry {
  const status = row.status === "working" || row.status === "waiting" ? row.status : "idle";
  const verb = status === "working" ? "Running" : status === "waiting" ? "Finished its turn" : "Last active";
  return {
    key: row.key,
    ...(row.canOpen ? { ref: row.ref } : {}),
    title: row.title,
    status,
    glyph: status,
    meaning: MEANING[status],
    summary: row.now || `${MEANING[status]} in ${row.project}`,
    lastAction: `${verb} in ${row.where} (${row.project})`,
    needs: status === "waiting" ? "Your next instruction: it has finished its turn" : NOTHING,
    at: row.at,
    satellite: status,
    onSlate: true,
  };
}

/** One of her background runs: the bird while it runs (the eye when it's asking Dan), then the ankh or broken staff. */
function runEntry(row: SessionRow, lastAction: string | undefined): GodEntry {
  const asking = row.status === "working" && row.state.phase === "waiting";
  const glyph: GodGlyph = asking ? "waiting" : row.status === "working" ? "background" : row.status === "done" ? "done" : "failed";
  const meaning = row.status === "stopped" ? "Stopped" : MEANING[glyph];
  const needs = asking ? "An answer: it has asked you something" : row.status === "failed" ? "A look at why it failed" : NOTHING;
  return {
    key: row.key,
    ...(row.canOpen ? { ref: row.ref } : {}),
    title: row.title,
    status: row.status,
    glyph,
    meaning,
    summary: row.now || `${row.where} in ${row.project}`,
    lastAction: lastAction ? oneLine(lastAction) : row.statusText,
    needs,
    at: row.at,
    ...(row.status === "working" ? { satellite: asking ? "waiting" : "working" } : {}),
    onSlate: true,
  };
}

/** A question waiting on Dan's answer: the eye. Nothing to open; the card itself is on screen. */
function decisionEntry(loop: Loop): GodEntry {
  return {
    key: `loop:${loop.id}`,
    title: loop.source || "A decision for you",
    status: "decision",
    glyph: "waiting",
    meaning: MEANING.waiting,
    summary: oneLine(loop.text),
    lastAction: "Asked you on a card",
    needs: `A decision: ${oneLine(loop.text, 100)}`,
    at: Date.parse(loop.openedAt) || 0,
    onSlate: true,
  };
}

/**
 * Everything God mode shows: every commanded session (open sessions and running runs, each a satellite), runs that
 * finished in the last couple of hours, and open decisions. The slate keeps the newest few, always including what
 * needs Dan; entries come newest first.
 */
export function godSlate(
  view: SessionsView,
  loops: readonly Loop[],
  now = Date.now(),
  runActions: ReadonlyMap<string, string> = new Map(),
): GodEntry[] {
  const entries: GodEntry[] = [];
  for (const row of view.open) entries.push(row.astra ? runEntry(row, row.run ? runActions.get(row.run) : undefined) : sessionEntry(row));
  for (const row of view.recent) {
    if (row.astra && row.status !== "working" && now - row.at < FINISHED_RUN_MS) entries.push(runEntry(row, row.run ? runActions.get(row.run) : undefined));
  }
  for (const loop of loops) if (loop.kind === "decision" && !loop.closedAt) entries.push(decisionEntry(loop));
  entries.sort((a, b) => b.at - a.at);

  const needing = entries.filter((e) => !e.needs.startsWith(NOTHING));
  const rest = entries.filter((e) => e.needs.startsWith(NOTHING));
  const shown = new Set([...needing, ...rest].slice(0, SLATE_MAX));
  for (const e of entries) e.onSlate = shown.has(e);
  return entries.filter((e) => e.onSlate || e.satellite);
}
