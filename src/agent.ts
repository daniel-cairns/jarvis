import fs from "node:fs/promises";
import {
  query,
  type CanUseTool,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { JarvisConfig } from "./config.js";
import { allowKey, decide, describeCall, parseAnswer, spokenQuestion, bringsInWebContent } from "./permissions.js";
import { loadSafeSites } from "./safeSites.js";
import { createFetchGuard, type FetchGuard } from "./security/fetchGuard.js";
import { jarvisInstructions } from "./prompt.js";
import { idleConnectors } from "./idleConnectors.js";
import { sessionEnv } from "./tools/runner.js";
import type { ComputerControl } from "./control/computer.js";
import type { CoffeeMode } from "./power/coffee.js";
import { createJarvisServer, SERVER_NAME, type SessionTools, type WindowTools } from "./tools/server.js";
import type { Position, UiAction } from "./ui/control.js";
import { toolEvents, type ToolEvent } from "./ui/worklog.js";
import type { TeardownGraph } from "./ui/graph.js";
import type { QuestionAnswer, QuestionSpec } from "./voice/answers.js";
import { isMetaReply } from "./voice/speechText.js";

export type JarvisIO = {
  /** Called with each piece of top-level assistant text as it arrives. */
  say(text: string): Promise<void>;
  /** Status lines that are shown but not spoken; tool calls come with their input for a short detail. */
  status(text: string, input?: Record<string, unknown>): void;
  /** A page-fetch security check started or ended (see GuardEvents): the orb shows its guardian. */
  guard?(phase: "start" | "ok" | "blocked"): void;
  /** Working the user's other Claude Code sessions. */
  sessions?: SessionTools;
  windows?: WindowTools;
  computer?: ComputerControl;
  coffee?: CoffeeMode;
  /** Each tool call and its result, for the terminal and git panels. */
  toolEvent?(e: ToolEvent): void;
  /** Works Astra's own interface (panels, minimise, stop); returns what happened. */
  ui?(action: UiAction, level?: number, position?: Position): string | Promise<string>;
  /** Asks the user a question (with options) and waits; null if they didn't answer. */
  question?(spec: QuestionSpec): Promise<QuestionAnswer | null>;
  /** Shows a teardown's 3D map (or a text version without the orb); returns where it went. */
  graph?(title: string, graph: TeardownGraph, say?: string): string;
  /** Puts detail on screen (the orb's panel, or the terminal); returns where it went. */
  show?(title: string, markdown: string, say?: string): string;
  /** Asks the user a yes/always/no question (spoken briefly, detail shown) and returns their raw answer. */
  ask(question: Approval): Promise<string>;
};

export type Approval = { spoken: string; detail: string };

export type TurnResult = { ok: boolean; costUsd: number; summary: string; timings?: TurnTimings };

/** Where a request's time went, in ms from when it was sent (null if it never got that far). */
export type TurnTimings = {
  /** Claude Code started and connected its tools (the init message). */
  readyMs: number | null;
  /** The model's first output of any kind (thinking, a tool call or words). */
  firstOutputMs: number | null;
  /** Her first words to say. */
  firstWordsMs: number | null;
  totalMs: number;
  /** Time spent waiting on the model, as Claude Code reports it. */
  apiMs?: number;
  steps?: number;
};

const sec = (ms: number | null | undefined) => (ms === null || ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);

/** One log line of a request's timings; `heardMs` is when her voice first came out of the speakers. */
export function timingLine(t: TurnTimings, heardMs?: number | null): string {
  const parts = [`ready ${sec(t.readyMs)}`, `first output ${sec(t.firstOutputMs)}`, `first words ${sec(t.firstWordsMs)}`];
  if (heardMs !== undefined) parts.push(`heard ${sec(heardMs)}`);
  parts.push(`total ${sec(t.totalMs)}`);
  if (t.apiMs !== undefined) parts.push(`model ${sec(t.apiMs)}`);
  if (t.steps !== undefined) parts.push(`${t.steps} step${t.steps === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

type QueryFn = typeof query;

export class Jarvis {
  private sessionId: string | undefined;
  private readonly sessionAllowed = new Set<string>();
  /**
   * Whether this conversation has read web content (see bringsInWebContent): false for a fresh one, undefined for a
   * resumed one (what it read before can't be known), true once anything from the web comes in.
   */
  private webContent: boolean | undefined = false;
  /** The security check on every page fetch (before and after); flagged fetches always ask, safe site or not. */
  private readonly fetchGuard: FetchGuard;
  private readonly reportedServers = new Set<string>();
  private abort: AbortController | null = null;

  constructor(
    private readonly cfg: JarvisConfig,
    private readonly io: JarvisIO,
    private readonly runQuery: QueryFn = query,
  ) {
    this.fetchGuard = createFetchGuard(
      { safeBrowsing: cfg.safeBrowsingKey, urlhaus: cfg.urlhausKey },
      { notify: (text) => io.status(text), checking: (phase) => io.guard?.(phase) },
    );
  }

  async init(): Promise<void> {
    await fs.mkdir(this.cfg.brainDir, { recursive: true });
    await fs.mkdir(this.cfg.workspaceDir, { recursive: true });
    // Creates ~/.jarvis/safe-sites.json with the defaults on first run, so it's there to edit.
    loadSafeSites(this.cfg.home);
  }

  /** Cancels the turn in progress, if any. */
  cancel(): boolean {
    if (!this.abort) return false;
    this.abort.abort();
    return true;
  }

  /** The Claude Code session she's in (undefined until her first reply). */
  get session(): string | undefined {
    return this.sessionId;
  }

  /** Continues from another of her conversations (resumed with its full context), or a fresh one with undefined. */
  resumeFrom(sessionId: string | undefined): void {
    this.sessionId = sessionId;
    this.sessionAllowed.clear();
    this.webContent = sessionId === undefined ? false : undefined;
  }

  /** Starts a fresh conversation; memory in the brain is kept. */
  reset(): void {
    this.sessionId = undefined;
    this.sessionAllowed.clear();
    this.webContent = false;
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
      systemPrompt: { type: "preset", preset: "claude_code", append: jarvisInstructions(this.cfg) },
      mcpServers: {
        [SERVER_NAME]: createJarvisServer(this.cfg, undefined, {
          showDetail: this.io.show?.bind(this.io),
          showGraph: this.io.graph?.bind(this.io),
          askQuestion: this.io.question?.bind(this.io),
          uiControl: this.io.ui?.bind(this.io),
          sessions: this.io.sessions,
          windows: this.io.windows,
          computer: this.io.computer,
          coffee: this.io.coffee,
        }),
        rea: { type: "stdio", command: reaCmd!, args: reaArgs },
        // Connectors whose app is closed would make every request wait 30 s (see idleConnectors).
        ...idleConnectors(),
      },
      permissionMode: "default",
      // Every page fetch is checked before it runs (even for sites your Claude Code settings allow) and after.
      hooks: this.fetchGuard.hooks,
      env: sessionEnv(),
      // Claude Code's question dialog has no voice or orb front end here; Astra asks out loud instead.
      disallowedTools: ["AskUserQuestion"],
      canUseTool: this.canUseTool,
      resume: this.sessionId,
    };
  }

  private readonly canUseTool: CanUseTool = async (toolName, input) => {
    const flagged = this.fetchGuard.takeFlags(toolName, input);
    const decision = flagged ? "ask" : decide(toolName, input, {
      workspaceDir: this.cfg.workspaceDir,
      brainDir: this.cfg.brainDir,
      sessionAllowed: this.sessionAllowed,
      // Read on each page fetch, so edits to the list apply without a restart.
      safeSites: () => loadSafeSites(this.cfg.home),
      webContent: this.webContent,
    });
    if (decision === "allow") return { behavior: "allow", updatedInput: input };

    const answer = parseAnswer(
      await this.io.ask({
        spoken: flagged ? `${spokenQuestion(toolName, input)} The security check flagged it.` : spokenQuestion(toolName, input),
        detail: `I'd like to ${describeCall(toolName, input)}.${flagged ? `\n\nSecurity check: ${flagged.join("; ")}.` : ""}`,
      }),
    );
    if (answer === "always") this.sessionAllowed.add(allowKey(toolName, input));
    if (answer === "no") return { behavior: "deny", message: "The user declined this action." };
    return { behavior: "allow", updatedInput: input };
  };

  async handle(prompt: string): Promise<TurnResult> {
    const abort = new AbortController();
    this.abort = abort;
    let result: TurnResult = { ok: false, costUsd: 0, summary: "No result" };
    const started = performance.now();
    this.turn = { started, readyMs: null, firstOutputMs: null, firstWordsMs: null };

    try {
      for await (const msg of this.runQuery({ prompt, options: this.buildOptions(abort) })) {
        // Once stopped, anything still arriving from this request is dropped, not spoken.
        if (abort.signal.aborted) break;
        result = (await this.onMessage(msg)) ?? result;
      }
      if (abort.signal.aborted) return { ok: false, costUsd: result.costUsd, summary: "Cancelled" };
      const { started: _started, ...marks } = this.turn;
      result = { ...result, timings: { ...marks, totalMs: performance.now() - started, ...result.timings } };
    } catch (err) {
      if (abort.signal.aborted) return { ok: false, costUsd: 0, summary: "Cancelled" };
      throw err;
    } finally {
      this.abort = null;
    }
    return result;
  }

  /** The request in flight, for its timings. */
  private turn = { started: 0, readyMs: null as number | null, firstOutputMs: null as number | null, firstWordsMs: null as number | null };

  private async onMessage(msg: SDKMessage): Promise<TurnResult | undefined> {
    for (const e of toolEvents(msg)) this.io.toolEvent?.(e);
    const at = performance.now() - this.turn.started;
    if (msg.type === "system" && msg.subtype === "init") this.turn.readyMs ??= at;
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      this.turn.firstOutputMs ??= at;
      if (msg.message.content.some((b) => b.type === "text" && b.text.trim() && !isMetaReply(b.text))) this.turn.firstWordsMs ??= at;
    }
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

    // Anything (including a subagent) reaching for the web taints the conversation for session_start/session_send.
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "tool_use" && bringsInWebContent(block.name, block.input as Record<string, unknown>)) this.webContent = true;
      }
    }
    // Subagent output (parent_tool_use_id set) stays silent; only Astra's own voice is spoken.
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      for (const block of msg.message.content) {
        // Queued, not waited on: the stream keeps being read, so a panel her next step opens takes its place right
        // after these words (see Speaker.cue) instead of popping up before them or long after.
        if (block.type === "text" && block.text.trim() && !isMetaReply(block.text)) void this.io.say(block.text).catch(() => {});
        if (block.type === "tool_use") this.io.status(`→ ${block.name}`, block.input as Record<string, unknown>);
        if (block.type === "thinking") this.io.status("… thinking");
      }
      return undefined;
    }

    if (msg.type === "result") {
      this.sessionId = msg.session_id;
      if (msg.subtype === "success") {
        return { ok: !msg.is_error, costUsd: msg.total_cost_usd, summary: msg.result, timings: { apiMs: msg.duration_api_ms, steps: msg.num_turns } as TurnTimings };
      }
      const why: Record<typeof msg.subtype, string> = {
        error_max_turns: "I hit my step limit for one request.",
        error_max_budget_usd: "I hit a spending cap for one request.",
        error_during_execution: "Something went wrong while I was working.",
        error_max_structured_output_retries: "I couldn't produce the structured output.",
      };
      await this.io.say(why[msg.subtype]);
      return { ok: false, costUsd: msg.total_cost_usd, summary: msg.subtype };
    }
    return undefined;
  }
}
