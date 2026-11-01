import fs from "node:fs/promises";
import {
  query,
  type CanUseTool,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { JarvisConfig } from "./config.js";
import { decide, describeCall, parseAnswer } from "./permissions.js";
import { jarvisInstructions } from "./prompt.js";
import { createJarvisServer, SERVER_NAME } from "./tools/server.js";

export type JarvisIO = {
  /** Called with each piece of top-level assistant text as it arrives. */
  say(text: string): Promise<void>;
  /** Status lines that are shown but not spoken. */
  status(text: string): void;
  /** Asks the user a yes/always/no question and returns their raw answer. */
  ask(question: string): Promise<string>;
};

export type TurnResult = { ok: boolean; costUsd: number; summary: string };

type QueryFn = typeof query;

export class Jarvis {
  private sessionId: string | undefined;
  private readonly sessionAllowed = new Set<string>();
  private abort: AbortController | null = null;

  constructor(
    private readonly cfg: JarvisConfig,
    private readonly io: JarvisIO,
    private readonly runQuery: QueryFn = query,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.cfg.brainDir, { recursive: true });
    await fs.mkdir(this.cfg.workspaceDir, { recursive: true });
  }

  /** Cancels the turn in progress, if any. */
  cancel(): boolean {
    if (!this.abort) return false;
    this.abort.abort();
    return true;
  }

  /** Starts a fresh conversation; memory in the brain is kept. */
  reset(): void {
    this.sessionId = undefined;
    this.sessionAllowed.clear();
  }

  buildOptions(abort: AbortController): Options {
    const [reaCmd, ...reaArgs] = this.cfg.reaCommand;
    return {
      abortController: abort,
      cwd: this.cfg.workspaceDir,
      additionalDirectories: [this.cfg.brainDir],
      model: this.cfg.model,
      effort: this.cfg.effort,
      thinking: { type: "adaptive" },
      maxBudgetUsd: this.cfg.maxBudgetUsd,
      systemPrompt: { type: "preset", preset: "claude_code", append: jarvisInstructions(this.cfg) },
      mcpServers: {
        [SERVER_NAME]: createJarvisServer(this.cfg),
        rea: { type: "stdio", command: reaCmd!, args: reaArgs },
      },
      permissionMode: "default",
      canUseTool: this.canUseTool,
      resume: this.sessionId,
    };
  }

  private readonly canUseTool: CanUseTool = async (toolName, input) => {
    const decision = decide(toolName, input, {
      workspaceDir: this.cfg.workspaceDir,
      sessionAllowed: this.sessionAllowed,
    });
    if (decision === "allow") return { behavior: "allow", updatedInput: input };

    const answer = parseAnswer(
      await this.io.ask(`I'd like to ${describeCall(toolName, input)}. Yes, always, or no?`),
    );
    if (answer === "always") this.sessionAllowed.add(toolName);
    if (answer === "no") return { behavior: "deny", message: "The user declined this action." };
    return { behavior: "allow", updatedInput: input };
  };

  async handle(prompt: string): Promise<TurnResult> {
    const abort = new AbortController();
    this.abort = abort;
    let result: TurnResult = { ok: false, costUsd: 0, summary: "No result" };

    try {
      for await (const msg of this.runQuery({ prompt, options: this.buildOptions(abort) })) {
        result = (await this.onMessage(msg)) ?? result;
      }
    } catch (err) {
      if (abort.signal.aborted) return { ok: false, costUsd: 0, summary: "Cancelled" };
      throw err;
    } finally {
      this.abort = null;
    }
    return result;
  }

  private async onMessage(msg: SDKMessage): Promise<TurnResult | undefined> {
    if (msg.type === "system" && msg.subtype === "init") {
      this.sessionId = msg.session_id;
      const failed = msg.mcp_servers.filter((s) => s.status !== "connected");
      for (const s of failed) this.io.status(`MCP server "${s.name}" is ${s.status}`);
      return undefined;
    }

    // Subagent output (parent_tool_use_id set) stays silent; only Jarvis's own voice is spoken.
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.trim()) await this.io.say(block.text);
        if (block.type === "tool_use") this.io.status(`→ ${block.name}`);
      }
      return undefined;
    }

    if (msg.type === "result") {
      this.sessionId = msg.session_id;
      if (msg.subtype === "success") {
        return { ok: !msg.is_error, costUsd: msg.total_cost_usd, summary: msg.result };
      }
      const why: Record<typeof msg.subtype, string> = {
        error_max_turns: "I hit my step limit for one request.",
        error_max_budget_usd: `I hit the $${this.cfg.maxBudgetUsd} spending cap for one request.`,
        error_during_execution: "Something went wrong while I was working.",
        error_max_structured_output_retries: "I couldn't produce the structured output.",
      };
      await this.io.say(why[msg.subtype]);
      return { ok: false, costUsd: msg.total_cost_usd, summary: msg.subtype };
    }
    return undefined;
  }
}
