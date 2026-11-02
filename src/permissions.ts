/**
 * Who decides what Astra may do without asking.
 * Reading, memory, web searches and opening things are free. Writing is free only inside the workspace.
 * Fetching a page is free only from a site on the safe-site list (see safeSites.ts); any other host asks, and
 * "always" then allows that one host for the session, never the whole web.
 * Shell commands, REA's tools and anything else ask you first, once per tool per session if you say "always".
 */
import path from "node:path";
import { hostOf, isSafeHost } from "./safeSites.js";
import { isInside } from "./tools/mac.js";

export type Decision = "allow" | "ask" | "deny";

const ALWAYS_ALLOWED = new Set(["Read", "Glob", "Grep", "WebSearch", "TodoWrite", "ToolSearch"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export function decide(
  toolName: string,
  input: Record<string, unknown>,
  ctx: {
    workspaceDir: string;
    brainDir?: string;
    sessionAllowed: ReadonlySet<string>;
    /** The safe-site list, read only when a page fetch needs it. */
    safeSites?: () => readonly string[];
  },
): Decision {
  if (toolName.startsWith("mcp__jarvis__")) return "allow";
  if (ALWAYS_ALLOWED.has(toolName)) return "allow";
  // A page fetch could carry your data to its host, so it's checked by host before the per-tool "always".
  if (toolName === "WebFetch") {
    const host = hostOf(input.url);
    if (!host) return "ask";
    if (isSafeHost(host, ctx.safeSites?.() ?? [])) return "allow";
    return ctx.sessionAllowed.has(allowKey(toolName, input)) ? "allow" : "ask";
  }
  if (WRITE_TOOLS.has(toolName)) {
    // Astra's own folders: the workspace she builds in and the brain she keeps notes in.
    const target = input.file_path ?? input.notebook_path;
    const roots = [ctx.workspaceDir, ...(ctx.brainDir ? [ctx.brainDir] : [])];
    if (typeof target === "string" && roots.some((root) => isInside(root, path.resolve(ctx.workspaceDir, target)))) {
      return "allow";
    }
  }
  if (ctx.sessionAllowed.has(toolName)) return "allow";
  return "ask";
}

/** What answering "always" allows for the rest of the session: one host for a page fetch, otherwise the whole tool. */
export function allowKey(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "WebFetch") {
    const host = hostOf(input.url);
    return host ? `WebFetch:${host}` : "WebFetch:";
  }
  return toolName;
}

/** One-line description of a tool call, short enough to read aloud. */
export function describeCall(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "WebFetch" && typeof input.url === "string") return `fetch ${input.url}`;
  if (toolName === "Bash" && typeof input.command === "string") return `run the command: ${input.command}`;
  if (WRITE_TOOLS.has(toolName) && typeof input.file_path === "string") return `write to ${input.file_path}`;
  const name = toolName.replace(/^mcp__([^_]+)__/, "$1: ");
  const json = JSON.stringify(input);
  return `use ${name} ${json.length > 160 ? `${json.slice(0, 157)}...` : json}`;
}

/** A short question for the speech engine; the full details go on screen, never read aloud. */
export function spokenQuestion(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash") return "May I run a shell command?";
  // The host only: a full URL can carry data, and it's unreadable aloud anyway.
  if (toolName === "WebFetch") {
    const host = hostOf(input.url);
    return host ? `May I fetch a page from ${host}?` : "May I fetch a web page?";
  }
  if (WRITE_TOOLS.has(toolName) && typeof input.file_path === "string") {
    return `May I write ${path.basename(input.file_path)}, outside your workspace?`;
  }
  const mcp = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcp) {
    const owner = mcp[1] === "rea" ? "REA's" : `${mcp[1]}'s`;
    return `May I use ${owner} ${mcp[2]!.replace(/_/g, " ")}?`;
  }
  return `May I use ${toolName}?`;
}

export type Answer = "yes" | "always" | "no";

/** Accepts typed or transcribed answers; whisper adds punctuation like "Yes." or "Always!". */
export function parseAnswer(raw: string): Answer {
  const a = raw.trim().toLowerCase().replace(/[.,!?]+/g, "").replace(/\s+/g, " ");
  if (["a", "always", "yes always", "always allow"].includes(a)) return "always";
  if (["y", "yes", "yeah", "yep", "ok", "okay", "go", "do it", "approve"].includes(a)) return "yes";
  return "no";
}
