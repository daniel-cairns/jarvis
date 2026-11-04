/**
 * Coffee mode: keeps the Mac awake (display, idle, disk and system sleep) with macOS's `caffeinate`, run as a child
 * Astra owns. `-w <Astra's pid>` makes caffeinate end by itself the moment Astra exits, even in a crash, so it can
 * never be left running. The state is saved, so coffee mode carries on through "Restart Astra"; quitting her clears it.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export type CoffeeChild = { kill(): void; on(event: "exit", listener: () => void): unknown };
export type Spawner = (cmd: string, args: string[]) => CoffeeChild;

/** Saved state: on, until a time (ISO) or with no end. */
type Saved = { until: string | null };

const realSpawn: Spawner = (cmd, args) => {
  const child = spawn(cmd, args, { stdio: "ignore" });
  child.on("error", () => {});
  return child;
};

export class CoffeeMode {
  private child: CoffeeChild | null = null;
  private until: number | null = null;
  /** Told whenever coffee mode turns on or off (for the orb's indicator). */
  onChange?: (on: boolean, until: number | null) => void;

  constructor(
    private readonly file: string,
    private readonly ownerPid = process.pid,
    private readonly spawner: Spawner = realSpawn,
    private readonly now: () => number = Date.now,
  ) {}

  get on(): boolean {
    return this.child !== null;
  }

  /** When it turns itself off (ms since the epoch), or null when it's off or open-ended. */
  get endsAt(): number | null {
    return this.on ? this.until : null;
  }

  /** Turns coffee mode on, for `minutes` or until turned off. Calling it again replaces the timer. */
  start(minutes?: number): string {
    if (minutes !== undefined && !(minutes > 0)) return "Say how long as a number of minutes, or leave it open-ended.";
    this.until = minutes ? this.now() + minutes * 60_000 : null;
    this.launch();
    this.save();
    return `Coffee mode on: the Mac stays awake ${this.describeEnd()}.`;
  }

  /** Turns coffee mode off and forgets it. */
  stop(): string {
    if (!this.child && !existsSync(this.file)) return "Coffee mode is already off.";
    this.halt();
    rmSync(this.file, { force: true });
    return "Coffee mode off: the Mac can sleep again.";
  }

  /** What to say when asked. */
  status(): string {
    return this.on ? `Coffee mode is on: the Mac stays awake ${this.describeEnd()}.` : "Coffee mode is off.";
  }

  /** At start-up: picks coffee mode back up if it was on before a restart (and hasn't run out). */
  resume(): boolean {
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(readFileSync(this.file, "utf8")) as Saved;
    } catch {
      return false;
    }
    const until = saved?.until ? Date.parse(saved.until) : null;
    if (until !== null && !(until > this.now())) {
      rmSync(this.file, { force: true });
      return false;
    }
    this.until = until;
    this.launch();
    return true;
  }

  /** On the way out: stops caffeinate. `keep` (a restart) leaves the saved state so it resumes. */
  shutdown(keep: boolean): void {
    this.halt(false);
    if (!keep) rmSync(this.file, { force: true });
  }

  private launch(): void {
    this.halt(false);
    const args = ["-dimsu", "-w", String(this.ownerPid)];
    if (this.until !== null) args.push("-t", String(Math.max(1, Math.round((this.until - this.now()) / 1000))));
    const child = this.spawner("caffeinate", args);
    this.child = child;
    child.on("exit", () => {
      if (this.child !== child) return;
      // It ended by itself: the timer ran out (or something killed it). Either way coffee mode is over.
      this.child = null;
      this.until = null;
      rmSync(this.file, { force: true });
      this.onChange?.(false, null);
    });
    this.onChange?.(true, this.until);
  }

  private halt(notify = true): void {
    const child = this.child;
    this.child = null;
    child?.kill();
    if (child && notify) this.onChange?.(false, null);
  }

  private save(): void {
    const saved: Saved = { until: this.until === null ? null : new Date(this.until).toISOString() };
    writeFileSync(this.file, JSON.stringify(saved));
  }

  private describeEnd(): string {
    if (this.until === null) return "until you turn it off";
    const mins = Math.max(1, Math.round((this.until - this.now()) / 60_000));
    const at = new Date(this.until).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
    const left = mins >= 60 ? `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}` : `${mins} min`;
    return `for ${left} (until ${at})`;
  }
}
