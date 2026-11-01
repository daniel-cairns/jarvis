import fs from "node:fs/promises";
import {
  query,
  type CanUseTool,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { JarvisConfig } from "./config.js";
import { decide, describeCall, parseAnswer, spokenQuestion } from "./permissions.js";
import { jarvisInstructions } from "./prompt.js";
import { createJarvisServer, SERVER_NAME } from "./tools/server.js";
import type { Position, UiAction } from "./ui/control.js";
import type { TeardownGraph } from "./ui/graph.js";
import type { QuestionAnswer, QuestionSpec } from "./voice/answers.js";

export type JarvisIO = {
  /** Called with each piece of top-level assistant text as it arrives. */
  say(text: string): Promise<void>;
  /** Status lines that are shown but not spoken; tool calls come with their input for a short detail. */
  status(text: string, input?: Record<string, unknown>): void;
  /** Works Astra's own interface (panels, minimise, stop); returns what happened. */
  ui?(action: UiAction, level?: number, position?: Position): string | Promise<string>;
  /** Asks the user a question (with options) and waits; null if they didn't answer. */
  question?(spec: QuestionSpec): Promise<QuestionAnswer | null>;
  /** Shows a teardown's 3D map (or a text version without the orb); returns where it went. */
  graph?(title: string, graph: TeardownGraph): string;
  /** Puts detail on screen (the orb's panel, or the terminal); returns where it went. */
  show?(title: string, markdown: string): string;
  /** Asks the user a yes/always/no question (spoken briefly, detail shown) and returns their raw answer. */
  ask(question: Approval): Promise<string>;
};

export type Approval = { spoken: string; detail: string };

export type TurnResult = { ok: boolean; costUsd: number; summary: string };

type QueryFn = typeof query;

export class Jarvis {
  private sessionId: string | undefined;
  private readonly sessionAllowed = new Set<string>();
  private readonly reportedServers = new Set<string>();
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
        [SERVER_NAME]: createJarvisServer(
          this.cfg,
          undefined,
          this.io.show?.bind(this.io),
          this.io.graph?.bind(this.io),
          this.io.question?.bind(this.io),
          this.io.ui?.bind(this.io),
        ),
        rea: { type: "stdio", command: reaCmd!, args: reaArgs },
      },
      permissionMode: "default",
      // Claude Code's question dialog has no voice or orb front end here; Astra asks out loud instead.
      disallowedTools: ["AskUserQuestion"],
      canUseTool: this.canUseTool,
      resume: this.sessionId,
    };
  }

  private readonly canUseTool: CanUseTool = async (toolName, input) => {
    const decision = decide(toolName, input, {
      workspaceDir: this.cfg.workspaceDir,
      brainDir: this.cfg.brainDir,
      sessionAllowed: this.sessionAllowed,
    });
    if (decision === "allow") return { behavior: "allow", updatedInput: input };

    const answer = parseAnswer(
      await this.io.ask({ spoken: spokenQuestion(toolName, input), detail: `I'd like to ${describeCall(toolName, input)}.` }),
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
        // Once stopped, anything still arriving from this request is dropped, not spoken.
        if (abort.signal.aborted) break;
        result = (await this.onMessage(msg)) ?? result;
      }
      if (abort.signal.aborted) return { ok: false, costUsd: result.costUsd, summary: "Cancelled" };
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
      // Each server problem is reported once per run, not on every request.
      for (const s of msg.mcp_servers) {
        const note = `${s.name}:${s.status}`;
        if (s.status === "connected" || this.reportedServers.has(note)) continue;
        this.reportedServers.add(note);
        this.io.status(`MCP server "${s.name}" is ${s.status}`);
      }
      return undefined;
    }

    // Subagent output (parent_tool_use_id set) stays silent; only Astra's own voice is spoken.
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.trim()) await this.io.say(block.text);
        if (block.type === "tool_use") this.io.status(`→ ${block.name}`, block.input as Record<string, unknown>);
        if (block.type === "thinking") this.io.status("… thinking");
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
