import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { jarvisInstructions } from "../src/prompt.js";
import { sendRefusal, summarise } from "../src/tools/sessions.js";

const now = Date.parse("2026-11-04T08:00:00Z");
const session = (over: Partial<Parameters<typeof sendRefusal>[0]> = {}) => ({
  title: "Jarvis local setup",
  project: "jarvis",
  source: "cli",
  lastActivity: new Date(now - 3 * 3600_000).toISOString(),
  ...over,
});

describe("sending work into an existing session", () => {
  it("refuses the one Dan is using in the Claude app, pointing to a fresh session", () => {
    const why = sendRefusal(session({ source: "claude-desktop", lastActivity: new Date(now - 4 * 60_000).toISOString() }), now);
    expect(why).toMatch(/open in the Claude app and was used 4 min ago/);
    expect(why).toMatch(/Start a fresh session in jarvis instead \(session_start\)/);
  });

  it("refuses a long one (this conversation carried 461k tokens), with no dollar talk", () => {
    const why = sendRefusal(session({ contextTokens: 461_343 }), now);
    expect(why).toMatch(/is long \(461k tokens of context\)/);
    expect(why).not.toMatch(/\$|dollar|cost/i);
  });

  it("allows a short session nobody is in", () => {
    expect(sendRefusal(session({ contextTokens: 40_000 }), now)).toBeNull();
    expect(sendRefusal(session({ source: "claude-desktop", lastActivity: new Date(now - 2 * 3600_000).toISOString() }), now)).toBeNull();
  });

  it("reads a session's context size from its latest reply", () => {
    const usage = { input_tokens: 10, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 5_000 };
    const s = summarise("id", [], [{ type: "assistant", message: { content: [{ type: "text", text: "Hi" }], usage, stop_reason: "end_turn" } }], new Date(now), now, () => true);
    expect(s.contextTokens).toBe(205_010);
  });
});

describe("credits only matter with an API key", () => {
  it("treats a plain login as a subscription and tells her to ignore dollar figures", () => {
    const cfg = loadConfig({ HOME: "/tmp/x" } as NodeJS.ProcessEnv);
    expect(cfg.billing).toBe("subscription");
    expect(jarvisInstructions(cfg)).toMatch(/Never mention dollar amounts or credits/);
  });

  it("treats a set ANTHROPIC_API_KEY as billed per request", () => {
    const cfg = loadConfig({ HOME: "/tmp/x", ANTHROPIC_API_KEY: "sk-test" } as NodeJS.ProcessEnv);
    expect(cfg.billing).toBe("api");
    expect(jarvisInstructions(cfg)).toMatch(/every request is billed/);
  });
});
