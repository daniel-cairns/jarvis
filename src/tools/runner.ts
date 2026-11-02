/**
 * Runs Claude Code sessions in the background for Astra: a new session in one of your projects, or a follow-up prompt
 * to an existing (idle) session, resumed by id. Progress and approvals come back through Astra; when a run ends she
 * reports it. Each run is a normal Claude Code session on disk, so it can be opened in the app afterwards.
 */
import { existsSync } from "node:fs";
import { query, type CanUseTool, type PermissionResult, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { JarvisConfig } from "../config.js";
import type { BackgroundPermissionMode } from "../settings.js";
import type { Approval } from "../agent.js";
import { allowKey, describeCall, parseAnswer } from "../permissions.js";
import { createFetchGuard } from "../security/fetchGuard.js";
import { toolEvents, type ToolEvent } from "../ui/worklog.js";
import type { QuestionAnswer, QuestionSpec } from "../voice/answers.js";

export type JobStatus = "running" | "done" | "failed" | "stopped";

export type Job = {
  /** Short handle Astra and you can use: "s1", "s2"… */
  id: string;
  label: string;
  folder: string;
  prompt: string;
  sessionId?: string;
  status: JobStatus;
  lastText: string;
  costUsd: number;
  startedAt: string;
  /** The permission mode it started with (see BackgroundPermissionMode). */
  permissionMode: BackgroundPermissionMode;
  /** Questions it asked (AskUserQuestion) that never reached Dan, for Astra to raise when it finishes. */
  unanswered: string[];
  abort: AbortController;
};

export type RunnerEvents = {
  /** A step in a background session ("gymclaw: Editing code: login.ts"). */
  activity(job: Job, toolName: string, input: Record<string, unknown>): void;
  /** A background session needs permission; resolves with the raw answer (yes / always / no). */
  ask(job: Job, approval: Approval): Promise<string>;
  /** A background session asked Dan a question (AskUserQuestion): his answer, or null if it couldn't be asked. */
  question?(job: Job, spec: QuestionSpec): Promise<QuestionAnswer | null>;
  /** Something the session said (top-level text), for the live transcript panel. */
  said?(job: Job, text: string): void;
  /** A run ended (done, failed or stopped). */
  finished(job: Job): void;
  /** Each tool call and its result in a background session, for the terminal and git panels. */
  toolEvent?(job: Job, e: ToolEvent): void;
  /** The page-fetch security check did something (blocked a site, cleaned a page). */
  security?(job: Job, text: string): void;
  /** A security check started or ended in a background session. */
  guard?(job: Job, phase: "start" | "ok" | "blocked"): void;
};

type QueryFn = typeof query;

/**
 * The environment for sessions Astra runs: hers, minus CLAUDE_CODE_ENTRYPOINT. Started from the Claude app's terminal
 * she inherits "claude-desktop", which mislabels her runs as app sessions (and picks the wrong link to open them).
 */
export function sessionEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "CLAUDE_CODE_ENTRYPOINT"),
  );
}

export class SessionRunner {
  private readonly jobs = new Map<string, Job>();
  private seq = 0;

  constructor(
    private readonly cfg: JarvisConfig,
    private readonly events: RunnerEvents,
    private readonly runQuery: QueryFn = query,
    /** Read at each launch, so a change to the setting applies to the next run. */
    private readonly permissionMode: () => BackgroundPermissionMode = () => "auto",
  ) {}

  list(): Job[] {
    return [...this.jobs.values()];
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id) ?? [...this.jobs.values()].find((j) => j.sessionId === id);
  }

  /** Starts a new session in `folder` with `prompt`. */
  start(folder: string, prompt: string, label: string): Job {
    return this.launch(folder, prompt, label);
  }

  /** Sends `prompt` to an existing session (resumed by id), in its own folder. */
  send(sessionId: string, folder: string, prompt: string, label: string): Job {
    return this.launch(folder, prompt, label, sessionId);
  }

  stop(id: string): boolean {
    const job = this.get(id);
    if (!job || job.status !== "running") return false;
    job.abort.abort();
    return true;
  }

  private launch(folder: string, prompt: string, label: string, resume?: string): Job {
    // A missing folder makes the launch fail as "binary failed to launch" (spawn ENOENT), which blames the wrong thing.
    if (!existsSync(folder)) throw new Error(`The ${label} session's folder no longer exists (${folder}), so I can't run it there.`);
    const job: Job = {
      id: `s${++this.seq}`,
      label,
      folder,
      prompt,
      ...(resume ? { sessionId: resume } : {}),
      status: "running",
      lastText: "",
      costUsd: 0,
      startedAt: new Date().toISOString(),
      permissionMode: this.permissionMode(),
      abort: new AbortController(),
      unanswered: [],
    };
    this.jobs.set(job.id, job);
    void this.run(job, resume);
    return job;
  }

  /**
   * A run's AskUserQuestion: each question goes to Dan as one of Astra's question cards, and his answers go back in
   * the tool's `answers` (question text → answer), which is how the SDK hands a tool its user's replies. Before this
   * it went through as a plain "may it use AskUserQuestion?" approval: Dan never saw the question and the run got no
   * answer. If a question can't be put to him, the tool is denied with instructions to report it instead, and the
   * question is kept on the job so Astra mentions it when the run ends.
   */
  private async askQuestions(job: Job, input: Record<string, unknown>): Promise<PermissionResult> {
    const questions = parseQuestions(input);
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const answer = this.events.question ? await this.events.question(job, q.spec).catch(() => null) : null;
      if (answer === null || (Array.isArray(answer) && !answer.length)) {
        job.unanswered.push(...questions.map((x) => x.text).filter((t) => !(t in answers)));
        return {
          behavior: "deny",
          message:
            "The user couldn't be asked this here, so they haven't seen it. Don't ask again: carry on with what doesn't depend on it, and put the question (with your recommended answer) at the top of your final report.",
        };
      }
      answers[q.text] = Array.isArray(answer) ? answer.join(", ") : answer;
    }
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  private async run(job: Job, resume?: string): Promise<void> {
    const sessionAllowed = new Set<string>();
    // The same page-fetch security check as Astra's own: before every fetch (even ones your settings allow) and after.
    const guard = createFetchGuard(
      { safeBrowsing: this.cfg.safeBrowsingKey, urlhaus: this.cfg.urlhausKey },
      { notify: (text) => this.events.security?.(job, text), checking: (phase) => this.events.guard?.(job, phase) },
    );
    // Claude Code's own settings (your allow-lists) decide first; anything it would ask about comes to you via Astra.
    const canUseTool: CanUseTool = async (toolName, input) => {
      if (toolName === "AskUserQuestion") return this.askQuestions(job, input);
      const flagged = guard.takeFlags(toolName, input);
      if (!flagged && sessionAllowed.has(allowKey(toolName, input))) return { behavior: "allow", updatedInput: input };
      const action = toolName === "Bash" ? "run a shell command" : toolName === "WebFetch" ? "fetch a web page" : `use ${toolName.replace(/^mcp__([^_]+)__/, "$1 ").replace(/_/g, " ")}`;
      const raw = await this.events.ask(job, {
        spoken: `The ${job.label} session wants to ${action}.${flagged ? " The security check flagged it." : ""}`,
        detail: `${job.label} session: I'd like to ${describeCall(toolName, input)}.${flagged ? `\n\nSecurity check: ${flagged.join("; ")}.` : ""}`,
      });
      const answer = parseAnswer(raw);
      if (answer === "always") sessionAllowed.add(allowKey(toolName, input));
      return answer === "no" ? { behavior: "deny", message: "The user declined this action." } : { behavior: "allow", updatedInput: input };
    };
    try {
      for await (const msg of this.runQuery({
        prompt: job.prompt,
        options: {
          abortController: job.abort,
          cwd: job.folder,
          model: this.cfg.model,
          // Auto mode as in your own sessions: its classifier decides under your settings' autoMode rules, and what it
          // can't decide still comes through canUseTool below, as an approval card via Astra.
          permissionMode: job.permissionMode,
          canUseTool,
          hooks: guard.hooks,
          env: sessionEnv(),
          ...(resume ? { resume } : {}),
        },
      })) {
        this.onMessage(job, msg);
      }
      if (job.status === "running") job.status = "done";
    } catch (err) {
      job.status = job.abort.signal.aborted ? "stopped" : "failed";
      if (job.status === "failed") job.lastText ||= (err as Error).message;
    } finally {
      this.events.finished(job);
    }
  }

  private onMessage(job: Job, msg: SDKMessage): void {
    for (const e of toolEvents(msg)) this.events.toolEvent?.(job, e);
    if (msg.type === "system" && msg.subtype === "init") job.sessionId = msg.session_id;
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.trim()) {
          job.lastText = block.text.trim();
          this.events.said?.(job, job.lastText);
        }
        if (block.type === "tool_use") this.events.activity(job, block.name, block.input as Record<string, unknown>);
      }
    }
    if (msg.type === "result") {
      job.sessionId = msg.session_id;
      job.costUsd = msg.total_cost_usd;
      if (msg.subtype === "success") {
        job.lastText = msg.result?.trim() || job.lastText;
        job.status = msg.is_error ? "failed" : "done";
      } else {
        job.status = "failed";
      }
    }
  }
}

/** AskUserQuestion's input as Astra's question cards (question, options, multi-select); malformed entries are skipped. */
export function parseQuestions(input: Record<string, unknown>): { text: string; spec: QuestionSpec }[] {
  const list = Array.isArray(input.questions) ? input.questions : [];
  return list.flatMap((raw) => {
    const q = raw as { question?: unknown; options?: unknown; multiSelect?: unknown };
    if (typeof q.question !== "string" || !q.question.trim()) return [];
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => o as { label?: unknown; description?: unknown })
      .filter((o) => typeof o.label === "string")
      .map((o) => ({ label: o.label as string, ...(typeof o.description === "string" ? { description: o.description } : {}) }));
    return [{ text: q.question, spec: { question: q.question, options, multiSelect: q.multiSelect === true, allowOther: true } }];
  });
}
