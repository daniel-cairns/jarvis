/**
 * "Continue last session": which of Astra's own conversations to resume. After a restart she carries on in the same
 * one by herself (markRestart); any other launch starts fresh, and this runs only when asked. Her conversations are
 * the Claude Code sessions whose folder is her workspace (her background runs work in other projects' folders), and
 * the one she was in is recorded as she goes.
 */
import fs from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectsRoot } from "./sessions.js";

/** Bigger than this, resuming would load a conversation too long to be useful (or to fit): she says so instead. */
export const MAX_RESUME_BYTES = 40 * 1024 * 1024;

const FILE = "last-session.json";

/** Remembers the conversation she's in, so the next launch can pick it up when asked. */
export function saveLastSession(home: string, id: string, now = new Date()): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, FILE), `${JSON.stringify({ id, at: now.toISOString() }, null, 2)}\n`);
}

export function readLastSession(home: string): string | undefined {
  try {
    const id = (JSON.parse(readFileSync(path.join(home, FILE), "utf8")) as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Claude Code keeps a folder's sessions under ~/.claude/projects/<the path with "/" and "." as "-">. */
export const projectDir = (folder: string, root = projectsRoot()) => path.join(root, folder.replace(/[/.]/g, "-"));

export type ResumePick = { id: string; bytes: number } | { problem: string };

/**
 * The conversation to resume: the one recorded before the restart, or failing that her newest other than the one
 * she's in now (and never one of her background runs). A problem, in plain words, if there's none to pick up or
 * it's too large or damaged to resume.
 */
export async function pickLastSession(opts: {
  home: string;
  workspaceDir: string;
  current?: string;
  exclude?: readonly string[];
  root?: string;
  maxBytes?: number;
}): Promise<ResumePick> {
  const dir = projectDir(opts.workspaceDir, opts.root);
  const skip = new Set([opts.current, ...(opts.exclude ?? [])].filter(Boolean));
  const recorded = readLastSession(opts.home);
  let id = recorded && !skip.has(recorded) && existsSync(path.join(dir, `${recorded}.jsonl`)) ? recorded : undefined;
  if (!id) {
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const dated = await Promise.all(
      files
        .filter((f) => f.endsWith(".jsonl") && !skip.has(f.slice(0, -6)))
        .map(async (f) => ({ id: f.slice(0, -6), mtime: (await fs.stat(path.join(dir, f)).catch(() => null))?.mtimeMs ?? 0 })),
    );
    id = dated.sort((a, b) => b.mtime - a.mtime)[0]?.id;
  }
  if (!id) return { problem: "I can't find an earlier conversation of mine to pick up." };

  const file = path.join(dir, `${id}.jsonl`);
  const bytes = (await fs.stat(file).catch(() => null))?.size ?? 0;
  if (bytes > (opts.maxBytes ?? MAX_RESUME_BYTES)) {
    return { problem: `Our last conversation is too long to pick up (${Math.round(bytes / 1024 / 1024)} MB).` };
  }
  if (!(await looksIntact(file))) return { problem: "Our last conversation's record looks damaged, so I can't pick it up." };
  return { id, bytes };
}

/** Whether the end of a transcript still reads as one: at least one message among its last lines parses. */
async function looksIntact(file: string): Promise<boolean> {
  const handle = await fs.open(file, "r").catch(() => null);
  if (!handle) return false;
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, size - length);
    return buf
      .toString("utf8")
      .split("\n")
      .some((line) => {
        try {
          const type = (JSON.parse(line) as { type?: unknown }).type;
          return type === "user" || type === "assistant";
        } catch {
          return false;
        }
      });
  } finally {
    await handle.close();
  }
}

const RESTART_MARK = "resume-after-restart";
/** A restart this long ago or less still counts as "just restarted". */
export const RESUME_WINDOW_MS = 10 * 60_000;

/** Left as she quits to restart, so the next start knows to carry on in the same conversation. */
export function markRestart(home: string, now = new Date()): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, RESTART_MARK), now.toISOString());
}

/**
 * Whether this start follows a restart (a marker from the last few minutes). Always clears the marker, so a later
 * ordinary launch starts fresh as before.
 */
export function takeRestartMark(home: string, now = Date.now()): boolean {
  const file = path.join(home, RESTART_MARK);
  if (!existsSync(file)) return false;
  let at = Number.NaN;
  try {
    at = Date.parse(readFileSync(file, "utf8").trim());
  } catch {}
  try {
    rmSync(file, { force: true });
  } catch {}
  return Number.isFinite(at) && now - at >= 0 && now - at <= RESUME_WINDOW_MS;
}
