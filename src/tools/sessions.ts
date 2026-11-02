/**
 * Reading your other Claude Code sessions (desktop app and CLI alike) from their transcripts in
 * ~/.claude/projects/<project>/<session-id>.jsonl: title, project, status and latest reply. Read-only.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SessionStatus = "working" | "waiting" | "idle";

export type SessionSummary = {
  id: string;
  title: string;
  project: string;
  folder: string;
  status: SessionStatus;
  lastActivity: string;
  source: string;
  lastReply: string;
  costUsd?: number;
};

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 512 * 1024;
/** A session whose transcript changed this recently, mid-turn, is working right now. */
export const ACTIVE_MS = 90_000;

export const projectsRoot = () => path.join(os.homedir(), ".claude", "projects");

type Entry = Record<string, unknown> & { type?: string };

/** Parses JSONL text, skipping a partial first line (from reading the tail) and anything malformed. */
function parseLines(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Entry);
    } catch {
      // A line cut by the tail read, or a malformed one.
    }
  }
  return out;
}

async function readEdges(file: string): Promise<{ head: Entry[]; tail: Entry[]; size: number; mtime: Date }> {
  const handle = await fs.open(file, "r");
  try {
    const { size, mtime } = await handle.stat();
    const read = async (start: number, length: number) => {
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      return buf.toString("utf8");
    };
    const head = parseLines(await read(0, Math.min(size, HEAD_BYTES)));
    const tail = size > HEAD_BYTES ? parseLines(await read(Math.max(0, size - TAIL_BYTES), Math.min(size, TAIL_BYTES))) : head;
    return { head, tail, size, mtime };
  } finally {
    await handle.close();
  }
}

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((c): c is { type: string; text: string } => !!c && typeof c === "object" && (c as { type?: string }).type === "text")
          .map((c) => c.text)
          .join("\n")
      : "";

/** Summarises one transcript. Exported for tests. */
export function summarise(id: string, head: Entry[], tail: Entry[], mtime: Date, now = Date.now(), exists: (dir: string) => boolean = existsSync): SessionSummary {
  const all = [...head, ...tail];
  const lastOf = (type: string) => [...tail].reverse().find((e) => e.type === type) ?? [...head].reverse().find((e) => e.type === type);
  const title =
    (lastOf("custom-title")?.customTitle as string | undefined) ??
    (lastOf("agent-name")?.agentName as string | undefined) ??
    (lastOf("last-prompt")?.lastPrompt as string | undefined) ??
    textOf((all.find((e) => e.type === "user")?.message as { content?: unknown } | undefined)?.content).slice(0, 80) ??
    "Untitled session";
  // Newest recorded folder that still exists: a project moved since leaves its old path in the latest entries.
  const recorded = [
    lastOf("relocated")?.relocatedCwd,
    ...[...all].reverse().map((e) => e.cwd),
  ].filter((c, i, list): c is string => typeof c === "string" && c !== "" && list.indexOf(c) === i);
  const folder = recorded.find((c) => exists(c)) ?? recorded[0] ?? "";
  const source = (all.find((e) => typeof e.entrypoint === "string")?.entrypoint as string | undefined) ?? "unknown";
  const turns = tail.filter((e) => e.type === "assistant" || e.type === "user");
  const last = turns.at(-1);
  const lastAssistant = [...tail].reverse().find((e) => e.type === "assistant" && textOf((e.message as { content?: unknown })?.content).trim());
  const stopReason = (([...tail].reverse().find((e) => e.type === "assistant")?.message ?? {}) as { stop_reason?: string }).stop_reason;
  const recent = now - mtime.getTime() < ACTIVE_MS;
  const midTurn = last?.type === "user" || (last?.type === "assistant" && stopReason !== "end_turn");
  const status: SessionStatus = recent && midTurn ? "working" : stopReason === "end_turn" && now - mtime.getTime() < 6 * 3600_000 ? "waiting" : "idle";
  const cost = lastOf("cost-state")?.totalCostUSD;
  return {
    id,
    title: title.trim() || "Untitled session",
    project: folder ? path.basename(folder) : "unknown",
    folder,
    status,
    lastActivity: mtime.toISOString(),
    source,
    lastReply: textOf((lastAssistant?.message as { content?: unknown } | undefined)?.content).trim(),
    ...(typeof cost === "number" ? { costUsd: Math.round(cost * 100) / 100 } : {}),
  };
}

/** Recent sessions across all projects, newest first. `project` filters by folder name (case-insensitive substring). */
export async function listSessions(opts: { limit?: number; project?: string; root?: string; exclude?: string[] } = {}): Promise<SessionSummary[]> {
  const root = opts.root ?? projectsRoot();
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: { file: string; id: string; mtime: number }[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(root, d.name);
    for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
      const id = f.replace(/\.jsonl$/, "");
      if (!f.endsWith(".jsonl") || !SESSION_ID.test(id)) continue;
      const stat = await fs.stat(path.join(dir, f)).catch(() => null);
      if (stat) files.push({ file: path.join(dir, f), id, mtime: stat.mtimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const wanted = opts.project?.toLowerCase();
  const out: SessionSummary[] = [];
  for (const f of files) {
    if (out.length >= (opts.limit ?? 12)) break;
    const { head, tail, mtime } = await readEdges(f.file).catch(() => ({ head: [], tail: [], size: 0, mtime: new Date(f.mtime) }));
    const s = summarise(f.id, head, tail, mtime);
    if (opts.exclude?.some((e) => s.folder && path.resolve(s.folder).startsWith(path.resolve(e)))) continue;
    if (wanted && !`${s.project} ${s.folder} ${s.title}`.toLowerCase().includes(wanted)) continue;
    out.push(s);
  }
  return out;
}

/** Finds one session by id, or by a title/project fragment (most recent match). */
export async function findSession(ref: string, root?: string): Promise<SessionSummary | null> {
  if (SESSION_ID.test(ref)) {
    return (await listSessions({ limit: 500, root })).find((s) => s.id === ref) ?? null;
  }
  return (await listSessions({ limit: 1, project: ref, root }))[0] ?? null;
}

/**
 * Links that open the Claude app (found in the app's own link handler): continue a desktop session, import and resume
 * any other session (e.g. one Astra ran in the background), or start a new session in a folder with a prompt filled in.
 */
export const appLinks = {
  open: (s: Pick<SessionSummary, "id" | "source">) =>
    s.source === "claude-desktop" ? `claude://code/continue?session=${s.id}` : `claude://resume?session=${s.id}`,
  newSession: (folder: string, prompt: string) =>
    `claude://code/new?${new URLSearchParams({ folder, q: prompt.slice(0, 4000), source: "desktop_action" }).toString()}`,
};

/**
 * Turns a spoken project name ("gymclaw", "budget app") into a folder: from the folders your sessions ran in, plus
 * ~/Workspace and ~/Code. An exact folder-name match wins, then the closest partial match. Absolute paths pass through.
 */
export async function resolveProject(name: string, known: string[], home = os.homedir()): Promise<string | null> {
  if (path.isAbsolute(name)) return (await fs.stat(name).catch(() => null))?.isDirectory() ? name : null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(name);
  if (!want) return null;
  const candidates = new Set(known.filter(Boolean));
  for (const base of [path.join(home, "Workspace"), path.join(home, "Code")]) {
    for (const d of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (d.isDirectory() && !d.name.startsWith(".")) candidates.add(path.join(base, d.name));
    }
  }
  const scored = [...candidates]
    .map((folder) => {
      const b = norm(path.basename(folder));
      return { folder, score: b === want ? 3 : b.startsWith(want) || want.startsWith(b) ? 2 : b.includes(want) ? 1 : 0 };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.folder.length - b.folder.length);
  return scored[0]?.folder ?? null;
}
