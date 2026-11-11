/**
 * Thoth, the scribe: the figure who rises behind the orb while Astra researches (web searches and fetches, her brain,
 * a teardown or report, REA analysis that only reads), the counterpart to Anubis on security checks. This decides when
 * he's up: only once research has lasted a moment, so a quick lookup doesn't flicker, with one glint as it finishes.
 * Anubis takes priority on the orb itself (see orb/figures.js).
 */
import path from "node:path";

/** Research must have lasted this long before Thoth rises. */
export const SCRIBE_DELAY_MS = 1_500;
/** How long his "found it" glint lasts before he sinks away. */
export const SCRIBE_GLINT_MS = 1_200;

export type ScribeState = "researching" | "found" | null;

// REA tools that only read: analysis, inspection, searching and listing. Its browser_* tools drive a browser and
// capture_* records the screen, so they aren't research.
const REA_READING = /^mcp__rea__(analy[sz]e|inspect|find|search|list|extract|read|get|scan|describe|decompile|disassemble)/;

/** Whether a tool call is research: looking things up rather than doing or making something. */
export function isResearch(name: string, input: Record<string, unknown> = {}, brainDir?: string): boolean {
  if (name === "WebSearch" || name === "WebFetch") return true;
  if (name === "mcp__jarvis__brain_search" || name === "mcp__jarvis__brain_read" || name === "mcp__jarvis__brain_list") return true;
  if (REA_READING.test(name)) return true;
  // Reading her brain directly: a teardown, a report, a note.
  if ((name === "Read" || name === "Grep" || name === "Glob") && brainDir) {
    const target = [input.file_path, input.path].find((v): v is string => typeof v === "string");
    if (target) {
      const rel = path.relative(path.resolve(brainDir), path.resolve(target));
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    }
  }
  return false;
}

type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as NodeJS.Timeout) };

/**
 * Tracks the research calls in flight and says when Thoth should rise, glint and sink. `show` receives each change
 * of state; it's only called when the state actually changes.
 */
export class Scribe {
  private readonly active = new Set<string>();
  private state: ScribeState = null;
  private rising: unknown;
  private sinking: unknown;

  constructor(
    private readonly show: (state: ScribeState) => void,
    private readonly timers: Timers = realTimers,
    private readonly delayMs = SCRIBE_DELAY_MS,
    private readonly glintMs = SCRIBE_GLINT_MS,
  ) {}

  /** A research call started. */
  start(id: string): void {
    this.active.add(id);
    if (this.sinking !== undefined) {
      // More research straight after the last: he stays up rather than glint and come back.
      this.timers.clear(this.sinking);
      this.sinking = undefined;
      this.set("researching");
      return;
    }
    if (this.state === "researching" || this.rising !== undefined) return;
    this.rising = this.timers.set(() => {
      this.rising = undefined;
      if (this.active.size) this.set("researching");
    }, this.delayMs);
  }

  /** A research call finished (or failed). */
  end(id: string): void {
    if (!this.active.delete(id) || this.active.size) return;
    if (this.rising !== undefined) {
      // Done before he rose: a quick lookup, nothing to show.
      this.timers.clear(this.rising);
      this.rising = undefined;
      return;
    }
    if (this.state !== "researching") return;
    this.set("found");
    this.sinking = this.timers.set(() => {
      this.sinking = undefined;
      this.set(null);
    }, this.glintMs);
  }

  /** The request ended or was stopped: whatever was in flight is over, and he goes at once. */
  reset(): void {
    this.active.clear();
    for (const h of [this.rising, this.sinking]) if (h !== undefined) this.timers.clear(h);
    this.rising = this.sinking = undefined;
    this.set(null);
  }

  private set(next: ScribeState): void {
    if (next === this.state) return;
    this.state = next;
    this.show(next);
  }
}
