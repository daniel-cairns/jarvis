/**
 * What Astra says about a panel she has just shown, from what the orb saw on screen (orb/visibility.cjs), never from
 * what she hoped: "Shown" only when the panel can really be seen. She used to report "Brought my panels to the front"
 * and "Shown in the detail panel" while every panel sat behind Chrome.
 */
export type PanelVisibility = { kind: string; onScreen: boolean; covered: boolean; coveredBy: string[] };

const NAMES: Record<string, string> = {
  detail: "the detail panel",
  graph: "the map",
  brain: "the brain browser",
  terminal: "the terminal panel",
  git: "the git panel",
  transcript: "the transcript",
  sessions: "the sessions panel",
  tallyline: "the Tallyline panel",
  "tallyline-app": "Tallyline",
};
export const panelName = (kind: string) => NAMES[kind] ?? `the ${kind} panel`;

const list = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * The result of showing one panel. `shown` is what she says when it really is on screen; `v` is null when the check
 * didn't come back (no answer from the orb in time, or the window list couldn't be read).
 */
export function shownReport(kind: string, shown: string, v: PanelVisibility | null | undefined): string {
  const name = panelName(kind);
  if (!v) return `I sent it to ${name}, but I couldn't check that it's on screen.`;
  if (!v.onScreen) return `I tried to show ${name}, but it isn't on screen. Tell Dan it didn't appear.`;
  if (v.covered) {
    return `I opened ${name}, but ${v.coveredBy.length ? list(v.coveredBy) : "other windows"} ${v.coveredBy.length > 1 ? "are" : "is"} covering it, so Dan can't see it.`;
  }
  return shown;
}

/** The result of "bring your panels to the front": which really came forward, and which are still hidden. */
export function frontReport(results: PanelVisibility[] | null | undefined): string {
  if (!results) return "I tried to bring my panels forward, but I couldn't check whether they're on screen.";
  if (!results.length) return "No panels are open.";
  const hidden = results.filter((r) => !r.onScreen || r.covered);
  if (!hidden.length) return results.length === 1 ? `Brought ${panelName(results[0]!.kind)} to the front.` : "Brought my panels to the front.";
  const shown = results.length - hidden.length;
  const why = (r: PanelVisibility) => (!r.onScreen ? "isn't on screen" : `is covered by ${r.coveredBy.length ? list(r.coveredBy) : "other windows"}`);
  const lines = hidden.map((r) => `${panelName(r.kind)} ${why(r)}`);
  return `${shown ? `Brought ${shown} of my ${results.length} panels forward, but ` : "I couldn't bring my panels forward: "}${list(lines)}.`;
}
