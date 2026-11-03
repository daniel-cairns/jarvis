/**
 * Tallyline (Dan's local work ledger) for Astra's Tallyline panels: is it up, start it if not, read its summary.
 * It runs on 127.0.0.1:4317 only. A server Astra starts is hers to stop when she quits; one Dan started is left alone.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const TALLYLINE_URL = "http://127.0.0.1:4317";

/** What GET /api/summary returns (see tallyline server/lib/summary.ts). */
export type TallylineSummary = {
  sprint: { id: number; name: string; projectKey: string; endDate: string | null; total: number; byStatus: { todo: number; inProgress: number; done: number } } | null;
  todaySeconds: number;
  recent: { key: string; summary: string; status: string | null; category: string | null; updatedAt: string }[];
};

export type TallylineDeps = {
  fetch?: typeof fetch;
  spawn?: (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; log: string }) => ChildProcess;
  exists?: (p: string) => boolean;
  /** How long a fresh server gets to answer, and how often to look. */
  startMs?: number;
  pollMs?: number;
};

const realSpawn: NonNullable<TallylineDeps["spawn"]> = (cmd, args, { cwd, env, log }) => {
  const out = createWriteStream(log, { flags: "a" });
  const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  child.on("error", () => {});
  return child;
};

export class Tallyline {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly logFile: string,
    private readonly deps: TallylineDeps = {},
  ) {}

  /** Tallyline's summary, or throws with a plain reason (not running, or an error from it). */
  async summary(): Promise<TallylineSummary> {
    const res = await (this.deps.fetch ?? fetch)(`${TALLYLINE_URL}/api/summary`, { signal: AbortSignal.timeout(3000) });
    // A server from before the summary endpoint: it's running, just not new enough for this panel.
    if (res.status === 404) throw new Error("the running Tallyline is an older build without /api/summary: rebuild it (npm run build) and restart it");
    if (!res.ok) throw new Error(`Tallyline answered ${res.status}`);
    return (await res.json()) as TallylineSummary;
  }

  /** Whether something answers on Tallyline's port (any HTTP answer: an older build still counts as running). */
  async up(): Promise<boolean> {
    try {
      await (this.deps.fetch ?? fetch)(`${TALLYLINE_URL}/`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      return false;
    }
  }

  /** Makes sure Tallyline is running, starting it in the background if need be. Throws why if it can't. */
  ensureRunning(): Promise<void> {
    return (this.starting ??= this.start().finally(() => (this.starting = null)));
  }

  private async start(): Promise<void> {
    if (await this.up()) return;
    const exists = this.deps.exists ?? existsSync;
    if (!exists(this.dir)) throw new Error(`Tallyline isn't at ${this.dir}.`);
    if (!exists(path.join(this.dir, ".output/server/index.mjs"))) {
      throw new Error("Tallyline hasn't been built yet: run npm run build in its folder.");
    }
    // The same as its `npm start`, run directly so Astra owns (and can stop) the actual server process.
    const child = (this.deps.spawn ?? realSpawn)(process.execPath, [".output/server/index.mjs"], {
      cwd: this.dir,
      env: { ...process.env, PORT: "4317", HOST: "127.0.0.1" },
      log: this.logFile,
    });
    this.child = child;
    let exited: number | null | undefined;
    child.once("exit", (code) => {
      exited = code;
      if (this.child === child) this.child = null;
    });
    const deadline = Date.now() + (this.deps.startMs ?? 15_000);
    while (Date.now() < deadline) {
      if (exited !== undefined) throw new Error(`Tallyline stopped as it started (exit ${exited}).${this.lastLog()}`);
      if (await this.up()) return;
      await new Promise((r) => setTimeout(r, this.deps.pollMs ?? 300));
    }
    this.stop();
    throw new Error(`Tallyline didn't answer within ${Math.round((this.deps.startMs ?? 15_000) / 1000)} s, so I stopped it.${this.lastLog()}`);
  }

  /** Stops the server Astra started (not one Dan started himself). */
  stop(): void {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  /** Whether Astra is running Tallyline herself (and so will stop it when she quits). */
  get ownsServer(): boolean {
    return this.child !== null;
  }

  private lastLog(): string {
    try {
      const tail = readFileSync(this.logFile, "utf8").trim().split("\n").slice(-3).join(" / ");
      return tail ? ` Last log lines: ${tail.slice(0, 300)}` : "";
    } catch {
      return "";
    }
  }
}
