/**
 * The egress gate: one check for every address Astra (or a background run) is about to reach out to, whichever tool
 * does it: WebFetch, launch_clean_browser, REA's browser tools, or any other tool given a `url`. It runs the same URL
 * check as page fetches (Quad9, URLhaus, Google Safe Browsing, plus signs in the address itself).
 */
import { checkUrl, type IndexDeps, type IndexKeys } from "./urlCheck.js";

export type EgressDecision = {
  /** allow: go ahead; ask: put it to Dan on a card first; deny: refuse outright. */
  decision: "allow" | "ask" | "deny";
  reasons: string[];
};

/** This machine: Astra's own served apps and dev servers. Nothing leaves, so there's nothing to check. */
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|::1)$/i;

/** The address a tool call would reach, if it has one: its `url` input, as a web address. */
export function outboundUrl(input: unknown): string | undefined {
  const url = (input as { url?: unknown } | null)?.url;
  return typeof url === "string" && url.trim() ? url.trim() : undefined;
}

/** Checks an outbound address. `reason` is what's reaching out (for the reasons Dan sees). */
export async function egress(url: string, reason: string, keys: IndexKeys, deps: IndexDeps = {}): Promise<EgressDecision> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { decision: "ask", reasons: [`${reason} was given something that isn't a web address`] };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { decision: "ask", reasons: [`${reason} wants to open a ${parsed.protocol} address, not a web page`] };
  }
  if (LOOPBACK.test(parsed.hostname.replace(/^\[|\]$/g, ""))) return { decision: "allow", reasons: [] };
  const result = await checkUrl(parsed.toString(), keys, deps);
  if (result.verdict === "block") return { decision: "deny", reasons: result.reasons };
  if (result.verdict === "warn") return { decision: "ask", reasons: result.reasons };
  return { decision: "allow", reasons: [] };
}
