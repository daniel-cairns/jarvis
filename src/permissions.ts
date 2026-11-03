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

/** What happens to a tool call: go ahead, or ask Dan. (Refusals come from hooks, e.g. the egress gate, not here.) */
export type Decision = "allow" | "ask";

const ALWAYS_ALLOWED = new Set(["Read", "Glob", "Grep", "WebSearch", "TodoWrite", "ToolSearch"]);
/**
 * Whether a tool call brings web content into the conversation: page fetches and searches, the clean browser, REA's
 * browser and page tools, and anything else given a url.
 */
export function bringsInWebContent(toolName: string, input: Record<string, unknown> = {}): boolean {
  if (toolName === "WebFetch" || toolName === "WebSearch") return true;
  if (toolName === "mcp__jarvis__launch_clean_browser" || toolName.startsWith("mcp__rea__")) return true;
  if (/browser|web_?page|fetch|scrape/i.test(toolName)) return true;
  return typeof input.url === "string" && /^https?:/i.test(input.url);
}

/** Astra's own tools that need Dan's yes on a card once web content is in play. */
const CONFIRM_FIRST = new Set(["mcp__jarvis__session_start", "mcp__jarvis__session_send"]);
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
    /** Whether this conversation has read web content: true, false, or undefined when it can't be known. */
    webContent?: boolean;
  },
): Decision {
  // Starting or messaging a background session sets work going with its own tools and permissions. A prompt injected
  // into a web page could ask for that, so once this conversation has read web content these ask Dan first. Before
  // then nothing she has read can be an attacker's, so they go straight through. Unknown (a resumed conversation)
  // asks, to be safe.
  if (CONFIRM_FIRST.has(toolName) && ctx.webContent !== false) return "ask";
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
  // The whole message, so Dan approves exactly what the session will be told.
  if (toolName === "mcp__jarvis__session_send") return `send the ${String(input.session ?? "")} session this message:\n\n${String(input.prompt ?? "")}`;
  if (toolName === "mcp__jarvis__session_start") {
    const where = input.where === "app" ? "in the Claude app" : "in the background";
    return `start a new session on ${String(input.project ?? "")} ${where}, with this prompt:\n\n${String(input.prompt ?? "")}`;
  }
  const name = toolName.replace(/^mcp__([^_]+)__/, "$1: ");
  const json = JSON.stringify(input);
  return `use ${name} ${json.length > 160 ? `${json.slice(0, 157)}...` : json}`;
}

/** A short question for the speech engine; the full details go on screen, never read aloud. */
export function spokenQuestion(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash") return "May I run a shell command?";
  if (toolName === "mcp__jarvis__session_send") return `May I message the ${String(input.session ?? "")} session? The message is on screen.`;
  if (toolName === "mcp__jarvis__session_start") return `May I start a new session on ${String(input.project ?? "")}? The prompt is on screen.`;
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
