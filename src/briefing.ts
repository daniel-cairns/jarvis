/**
 * What happened outside Dan's conversation with Astra: his answers on a background run's cards, a run finishing.
 * Held until her next turn, so she knows what he already decided (and doesn't ask again), and so a run's report
 * reaches him in her words rather than as the run's own.
 */
import type { Job } from "./tools/runner.js";

/** Her turn when a run finished and nobody spoke: she says what it means for Dan, or nothing. */
export const BRIEF_REQUEST =
  "(Nobody spoke: this is a background update for you to pass on.) In one short sentence, in your own words, tell " +
  "Dan what it means for him and whether he needs to do anything. Don't relay the session's wording or repeat what " +
  "you've already told him. If it needs his decision, ask with ask_user. If none of it matters to him now, say nothing.";

const REPORT_CHARS = 2000;

export class Briefing {
  private notes: { text: string; tell: boolean }[] = [];

  /** Adds a note for her next turn; `tell` means Dan needs to hear about it even if he says nothing. */
  add(text: string, tell = false): void {
    this.notes.push({ text, tell });
  }

  /** There's something Dan should be told. */
  get due(): boolean {
    return this.notes.some((n) => n.tell);
  }

  /** Hands every note over as context to put before her next request (and forgets them); "" when there are none. */
  take(): string {
    if (!this.notes.length) return "";
    const lines = this.notes.map((n) => `- ${n.text}`).join("\n");
    this.notes = [];
    return `(Since your last reply, and not yet mentioned by you:\n${lines})\n\n`;
  }
}

/** A run's finish as a note for her: how it ended, its own report, and any questions that never reached Dan. */
export function runFinishedNote(job: Pick<Job, "id" | "label" | "status" | "lastText" | "unanswered">): string {
  const how = job.status === "done" ? "finished" : job.status === "stopped" ? "was stopped" : "ran into a problem";
  const report = job.lastText.trim();
  const clipped = report.length > REPORT_CHARS ? `${report.slice(0, REPORT_CHARS)}…` : report;
  const asked = job.unanswered.length ? ` Questions it had that never reached Dan: ${job.unanswered.join(" | ")}` : "";
  return `The ${job.label} background session (${job.id}) ${how}.${clipped ? ` Its final message: """${clipped}"""` : ""}${asked}`;
}

/** Dan's answer on a run's card, so she knows it's settled. */
export const answeredNote = (label: string, question: string, answer: string): string =>
  `Dan answered the ${label} session's question "${question}" with: ${answer}. It's settled; don't ask him again.`;
