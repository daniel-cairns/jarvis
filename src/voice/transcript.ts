/** Long transcript mode: recognising its start and stop phrases, and writing the transcript up. */

export type TranscriptLine = { at: number; text: string };

/** "start a transcript", "start recording", "take notes", "transcript mode" (optionally "called/about …"). */
export function parseTranscriptStart(request: string): { title?: string } | null {
  const s = request.trim().replace(/[.!?]+$/, "");
  const m = s.match(
    /^(?:please\s+)?(?:start(?:\s+a)?(?:\s+long)?\s+(?:transcript(?:ion)?|recording|dictation)|start\s+recording|take\s+notes|transcript\s+mode|dictation\s+mode|record\s+(?:this|everything))(?:\s+(?:called|titled|named|for|about|of)\s+(.+))?$/i,
  );
  if (!m) return null;
  const title = m[1]?.trim();
  return title ? { title } : {};
}

// "Astra, stop recording", "stop the transcript", "end recording", "finish the dictation", "that's all, stop recording".
const STOP = /(?:\b(?:astra|astrid|astro)\b[\s,.]*)?\b(?:stop|end|finish)\s+(?:the\s+|this\s+)?(?:recording|transcript(?:ion)?|dictation|taking notes)\b[\s.!,]*/i;

/** Splits a chunk at the stop phrase: what came before it is kept; `stop` says whether it was said. */
export function splitStop(text: string): { kept: string; stop: boolean } {
  const m = text.match(STOP);
  if (!m || m.index === undefined) return { kept: text.trim(), stop: false };
  return { kept: text.slice(0, m.index).replace(/[\s,;:-]+$/, "").trim(), stop: true };
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const wordCount = (lines: TranscriptLine[]) => lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);

/** The transcript as markdown, each line stamped with its time from the start. */
export function transcriptMarkdown(title: string, startedAt: number, lines: TranscriptLine[], endedAt?: number): string {
  const when = new Date(startedAt).toLocaleString("en-NZ", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const length = endedAt ? ` · ${clock(endedAt - startedAt)}` : " · recording";
  const head = `# ${title}\n\n_Recorded ${when}${length} · ${wordCount(lines)} words_\n`;
  const body = lines.length ? lines.map((l) => `**[${clock(l.at - startedAt)}]** ${l.text}`).join("\n\n") : "_Nothing yet: start talking._";
  return `${head}\n${body}\n`;
}
