/**
 * Who decides what Jarvis may do without asking.
 * Reading, memory and opening things are free. Writing is free only inside the workspace.
 * Shell commands, REA's tools and anything else ask you first, once per tool per session if you say "always".
 */
import path from "node:path";
import { isInside } from "./tools/mac.js";

export type Decision = "allow" | "ask" | "deny";

const ALWAYS_ALLOWED = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite", "ToolSearch"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export function decide(
  toolName: string,
  input: Record<string, unknown>,
  ctx: { workspaceDir: string; sessionAllowed: ReadonlySet<string> },
): Decision {
  if (toolName.startsWith("mcp__jarvis__")) return "allow";
  if (ALWAYS_ALLOWED.has(toolName)) return "allow";
  if (WRITE_TOOLS.has(toolName)) {
    const target = input.file_path ?? input.notebook_path;
    if (typeof target === "string" && isInside(ctx.workspaceDir, path.resolve(ctx.workspaceDir, target))) {
      return "allow";
    }
  }
  if (ctx.sessionAllowed.has(toolName)) return "allow";
  return "ask";
}

/** One-line description of a tool call, short enough to read aloud. */
export function describeCall(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash" && typeof input.command === "string") return `run the command: ${input.command}`;
  if (WRITE_TOOLS.has(toolName) && typeof input.file_path === "string") return `write to ${input.file_path}`;
  const name = toolName.replace(/^mcp__([^_]+)__/, "$1: ");
  const json = JSON.stringify(input);
  return `use ${name} ${json.length > 160 ? `${json.slice(0, 157)}...` : json}`;
}

export type Answer = "yes" | "always" | "no";

export function parseAnswer(raw: string): Answer {
  const a = raw.trim().toLowerCase();
  if (["a", "always", "yes always", "always allow"].includes(a)) return "always";
  if (["y", "yes", "yeah", "yep", "ok", "okay", "go", "do it", "approve"].includes(a)) return "yes";
  return "no";
}
