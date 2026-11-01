/**
 * Runs Claude Code sessions in the background for Astra: a new session in one of your projects, or a follow-up prompt
 * to an existing (idle) session, resumed by id. Progress and approvals come back through Astra; when a run ends she
 * reports it. Each run is a normal Claude Code session on disk, so it can be opened in the app afterwards.
 */
import { query, type CanUseTool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { JarvisConfig } from "../config.js";
import type { Approval } from "../agent.js";
import { describeCall, parseAnswer } from "../permissions.js";

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
  abort: AbortController;
};

export type RunnerEvents = {
  /** A step in a background session ("gymclaw: Editing code: login.ts"). */
  activity(job: Job, toolName: string, input: Record<string, unknown>): void;
  /** A background session needs permission; resolves with the raw answer (yes / always / no). */
  ask(job: Job, approval: Approval): Promise<string>;
  /** A run ended (done, failed or stopped). */
  finished(job: Job): void;
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
      abort: new AbortController(),
    };
    this.jobs.set(job.id, job);
    void this.run(job, resume);
    return job;
  }

  private async run(job: Job, resume?: string): Promise<void> {
    const sessionAllowed = new Set<string>();
    // Claude Code's own settings (your allow-lists) decide first; anything it would ask about comes to you via Astra.
    const canUseTool: CanUseTool = async (toolName, input) => {
      if (sessionAllowed.has(toolName)) return { behavior: "allow", updatedInput: input };
      const raw = await this.events.ask(job, {
        spoken: `The ${job.label} session wants to ${toolName === "Bash" ? "run a shell command" : `use ${toolName.replace(/^mcp__([^_]+)__/, "$1 ").replace(/_/g, " ")}`}.`,
        detail: `${job.label} session: I'd like to ${describeCall(toolName, input)}.`,
      });
      const answer = parseAnswer(raw);
      if (answer === "always") sessionAllowed.add(toolName);
      return answer === "no" ? { behavior: "deny", message: "The user declined this action." } : { behavior: "allow", updatedInput: input };
    };
    try {
      for await (const msg of this.runQuery({
        prompt: job.prompt,
        options: {
          abortController: job.abort,
          cwd: job.folder,
          model: this.cfg.model,
          maxBudgetUsd: this.cfg.maxBudgetUsd,
          permissionMode: "default",
          canUseTool,
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
    if (msg.type === "system" && msg.subtype === "init") job.sessionId = msg.session_id;
    if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text.trim()) job.lastText = block.text.trim();
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
