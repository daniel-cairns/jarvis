/** The windows Astra has shown recently, so you can ask for any of them again after she's tidied them away. */

export type WindowKind = "detail" | "graph" | "brain" | "terminal" | "git" | "transcript" | "tallyline";

export type WindowEntry = {
  /** Same key = same window: a newer one replaces the older entry. */
  key: string;
  kind: WindowKind;
  title: string;
  at: number;
  /** Which request it was shown during (0 before the first). */
  request: number;
  reopen: () => void | Promise<void>;
};

const KIND_WORDS: Record<WindowKind, string[]> = {
  detail: ["detail", "panel", "details"],
  graph: ["map", "graph", "3d"],
  brain: ["brain", "notes", "teardowns"],
  terminal: ["terminal", "commands", "command", "shell"],
  git: ["git", "changes", "diff", "diffs"],
  transcript: ["transcript", "run", "session", "background", "log"],
  tallyline: ["tallyline", "ledger", "sprint", "issues"],
};

const KIND_NAMES: Record<WindowKind, string> = {
  detail: "detail panel",
  graph: "map",
  brain: "brain browser",
  terminal: "terminal",
  git: "git changes",
  transcript: "transcript",
  tallyline: "Tallyline panel",
};

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
// Words that say nothing about which window: "show me the … again".
const FILLER = new Set(["show", "me", "the", "my", "your", "again", "please", "window", "open", "reopen", "back", "that", "last", "one"]);

export class WindowHistory {
  private entries: WindowEntry[] = [];

  constructor(private readonly max = 15) {}

  record(entry: WindowEntry): void {
    this.entries = [entry, ...this.entries.filter((e) => e.key !== entry.key)].slice(0, this.max);
  }

  /** Newest first. */
  list(): readonly WindowEntry[] {
    return this.entries;
  }

  /** Every window shown during the most recent request that showed any. */
  latest(): WindowEntry[] {
    const newest = this.entries[0];
    return newest ? this.entries.filter((e) => e.request === newest.request) : [];
  }

  /**
   * The window best matching a description ("the sit rep", "terminal", "gymclaw map"): the most words in common with
   * its title or kind, newest winning a tie. Undefined when nothing matches.
   */
  find(which: string): WindowEntry | undefined {
    const wanted = words(which).filter((w) => !FILLER.has(w));
    if (!wanted.length) return undefined;
    let best: WindowEntry | undefined;
    let bestScore = 0;
    for (const e of this.entries) {
      const have = new Set([...words(e.title), ...KIND_WORDS[e.kind]]);
      const score = wanted.filter((w) => have.has(w)).length;
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  /** A short list for her to read from: "Sit rep (detail panel, 3 min ago)". */
  describe(now = Date.now()): string {
    if (!this.entries.length) return "I haven't shown any windows yet.";
    return this.entries
      .map((e) => {
        const mins = Math.round((now - e.at) / 60_000);
        return `- ${e.title} (${KIND_NAMES[e.kind]}, ${mins < 1 ? "just now" : `${mins} min ago`})`;
      })
      .join("\n");
  }
}
