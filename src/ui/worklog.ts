/**
 * What Astra (and the sessions she runs) actually do, for the terminal and git panels: the shell commands with their
 * output, and the folders that commands and file edits touch.
 */
import os from "node:os";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type ToolEvent =
  | { kind: "use"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "result"; id: string; output: string; isError: boolean };

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c) => (c && typeof c === "object" && "text" in c && typeof c.text === "string" ? c.text : "")).join("\n")
      : "";

/** Tool calls and their results in one top-level message (subagents' are left out). */
export function toolEvents(msg: SDKMessage): ToolEvent[] {
  if ((msg.type !== "assistant" && msg.type !== "user") || msg.parent_tool_use_id !== null) return [];
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const events: ToolEvent[] = [];
  for (const block of content as { type?: string; [k: string]: unknown }[]) {
    if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      events.push({ kind: "use", id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      events.push({ kind: "result", id: block.tool_use_id, output: textOf(block.content), isError: block.is_error === true });
    }
  }
  return events;
}

export type TermEntry = {
  id: string;
  source: string;
  command: string;
  cwd: string;
  output: string;
  status: "running" | "ok" | "error";
  at: string;
};

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const MAX_ENTRIES = 60;
const MAX_OUTPUT = 20_000;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

const expand = (p: string) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

/** The folder a command starts in when it begins with `cd <dir> &&` (or `;`), else null. */
export function cdTarget(command: string, cwd: string): string | null {
  const m = command.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;)/);
  const dir = m?.[1] ?? m?.[2] ?? m?.[3];
  return dir ? path.resolve(cwd, expand(dir)) : null;
}

export class WorkLog {
  readonly entries: TermEntry[] = [];
  /** Folders touched by commands and edits, most recent first. */
  readonly touched: string[] = [];
  private readonly pendingEdits = new Set<string>();

  /** Records one event. Returns what changed: the terminal, and/or files (worth a git refresh). */
  record(source: string, cwd: string, e: ToolEvent): { terminal: boolean; files: boolean } {
    if (e.kind === "use") {
      if (e.name === "Bash" && typeof e.input.command === "string") {
        const dir = cdTarget(e.input.command, cwd) ?? cwd;
        this.entries.push({ id: e.id, source, command: e.input.command, cwd: dir, output: "", status: "running", at: new Date().toISOString() });
        if (this.entries.length > MAX_ENTRIES) this.entries.shift();
        this.touch(dir);
        return { terminal: true, files: false };
      }
      const file = e.input.file_path ?? e.input.notebook_path;
      if (EDIT_TOOLS.has(e.name) && typeof file === "string") {
        this.touch(path.dirname(path.resolve(cwd, expand(file))));
        this.pendingEdits.add(e.id);
      }
      return { terminal: false, files: false };
    }
    const entry = this.entries.find((x) => x.id === e.id);
    if (entry) {
      const out = e.output.replace(ANSI, "");
      entry.output = out.length > MAX_OUTPUT ? `…${out.slice(-MAX_OUTPUT)}` : out;
      entry.status = e.isError ? "error" : "ok";
      return { terminal: true, files: true };
    }
    if (this.pendingEdits.delete(e.id)) return { terminal: false, files: true };
    return { terminal: false, files: false };
  }

  private touch(dir: string): void {
    const i = this.touched.indexOf(dir);
    if (i >= 0) this.touched.splice(i, 1);
    this.touched.unshift(dir);
    if (this.touched.length > 20) this.touched.pop();
  }
}
