/**
 * The page-fetch security check as Agent SDK hooks, shared by Astra and the background sessions she runs.
 * Before any tool reaches out to a `url` (WebFetch, launch_clean_browser, REA's browser tools…), the egress gate
 * checks it: a threat-list hit is refused, a warning sign forces an approval (see takeFlags). After a WebFetch,
 * before the model reads it: the page is cleaned and labelled. Hooks run ahead of Claude Code's own allow rules,
 * so sites allowed in your settings are checked too.
 */
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import { hostOf } from "../safeSites.js";
import { scanContent } from "./contentScan.js";
import { egress, outboundUrl } from "./egress.js";
import type { IndexDeps, IndexKeys } from "./urlCheck.js";

export type FetchGuard = {
  hooks: NonNullable<Options["hooks"]>;
  /** Why a fetch was flagged, if it was (and forgets it): the approval for it should ask, showing these. */
  takeFlags(toolName: string, input: Record<string, unknown>): string[] | undefined;
};

export type GuardEvents = {
  /** What the check did (blocked a site, cleaned a page), for the orb and terminal. */
  notify(text: string): void;
  /** A check started, or ended: passed ("ok") or refused ("blocked"). Drives the guardian on the orb. */
  checking?(phase: "start" | "ok" | "blocked"): void;
};

export function createFetchGuard(keys: IndexKeys, events: GuardEvents, deps: IndexDeps = {}): FetchGuard {
  const { notify } = events;
  const flagged = new Map<string, string[]>();

  const before: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const url = outboundUrl(input.tool_input);
    if (!url) return {};
    events.checking?.("start");
    const gate = await egress(url, input.tool_name, keys, deps);
    const result = { verdict: gate.decision === "deny" ? "block" : gate.decision === "ask" ? "warn" : "ok", reasons: gate.reasons };
    events.checking?.(result.verdict === "block" ? "blocked" : "ok");
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
      flagged.set(`${input.tool_name} ${url}`, result.reasons);
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
    events.checking?.("start");
    const scan = scanContent(result, source);
    events.checking?.("ok");
    if (scan.findings.length) notify(`Security check cleaned ${source}: removed ${scan.findings.join("; ")}`);
    const updatedToolOutput = typeof response === "string" ? scan.text : { ...(response as object), result: scan.text };
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput } };
  };

  return {
    hooks: {
      // Every tool: any call with a `url` goes through the egress gate (calls without one pass straight through).
      PreToolUse: [{ hooks: [before] }],
      PostToolUse: [{ matcher: "WebFetch", hooks: [after] }],
    },
    takeFlags(toolName, input) {
      const url = outboundUrl(input);
      if (!url) return undefined;
      const key = `${toolName} ${url}`;
      const reasons = flagged.get(key);
      flagged.delete(key);
      return reasons;
    },
  };
}
