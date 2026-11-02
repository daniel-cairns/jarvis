/**
 * The page-fetch security check as Agent SDK hooks, shared by Astra and the background sessions she runs.
 * Before a WebFetch: a threat-list hit is refused, a warning sign forces an approval (see takeFlags). After it,
 * before the model reads it: the page is cleaned and labelled. Hooks run ahead of Claude Code's own allow rules,
 * so sites allowed in your settings are checked too.
 */
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import { hostOf } from "../safeSites.js";
import { scanContent } from "./contentScan.js";
import { checkUrl, type IndexDeps, type IndexKeys } from "./urlCheck.js";

export type FetchGuard = {
  hooks: NonNullable<Options["hooks"]>;
  /** Why a fetch was flagged, if it was (and forgets it): the approval for it should ask, showing these. */
  takeFlags(toolName: string, input: Record<string, unknown>): string[] | undefined;
};

/** `notify` hears what the check did (blocked a site, cleaned a page), for the orb and terminal. */
export function createFetchGuard(keys: IndexKeys, notify: (text: string) => void, deps: IndexDeps = {}): FetchGuard {
  const flagged = new Map<string, string[]>();

  const before: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const url = (input.tool_input as { url?: unknown }).url;
    if (typeof url !== "string") return {};
    const result = await checkUrl(url, keys, deps);
    const host = hostOf(url) ?? "that address";
    if (result.verdict === "block") {
      notify(`Security check blocked ${host}: ${result.reasons[0]}`);
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `The security check blocked ${host}: ${result.reasons.join("; ")}. Don't try to reach it another way; tell the user.`,
        },
      };
    }
    if (result.verdict === "warn") {
      flagged.set(url, result.reasons);
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: `Security check: ${result.reasons.join("; ")}` },
      };
    }
    return {};
  };

  const after: HookCallback = async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const response = input.tool_response;
    const result = typeof response === "string" ? response : (response as { result?: unknown } | null)?.result;
    if (typeof result !== "string") return {};
    const source = hostOf((input.tool_input as { url?: unknown }).url) ?? "the web";
    const scan = scanContent(result, source);
    if (scan.findings.length) notify(`Security check cleaned ${source}: removed ${scan.findings.join("; ")}`);
    const updatedToolOutput = typeof response === "string" ? scan.text : { ...(response as object), result: scan.text };
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput } };
  };

  return {
    hooks: {
      PreToolUse: [{ matcher: "WebFetch", hooks: [before] }],
      PostToolUse: [{ matcher: "WebFetch", hooks: [after] }],
    },
    takeFlags(toolName, input) {
      if (toolName !== "WebFetch" || typeof input.url !== "string") return undefined;
      const reasons = flagged.get(input.url);
      flagged.delete(input.url);
      return reasons;
    },
  };
}
