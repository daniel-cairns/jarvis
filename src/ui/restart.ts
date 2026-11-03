/**
 * When Astra can restart herself, and what she says when she can't yet. Pure, so the waiting rules can be tested;
 * src/index.ts does the restarting.
 */

export type RestartState = {
  /** She's in the middle of a reply. */
  busy: boolean;
  /** Background runs still going, as "s2 (hierogitics)". */
  running: string[];
};

/** How often a pending restart checks whether it can go ahead. */
export const RESTART_CHECK_MS = 5_000;
/** How long a restart may wait before she says it's still blocked (and by what), instead of staying silent. */
export const RESTART_REPORT_MS = 10 * 60_000;

/** What's stopping a restart right now, in plain words, or null when she can restart. */
export function restartBlocker(state: RestartState): string | null {
  if (state.running.length) {
    const list = state.running.length === 1 ? state.running[0] : `${state.running.slice(0, -1).join(", ")} and ${state.running.at(-1)}`;
    return `${list} ${state.running.length === 1 ? "is" : "are"} still running`;
  }
  if (state.busy) return "I'm still in the middle of a reply";
  return null;
}

/** The reply to a restart request that has to wait. */
export function waitingMessage(state: RestartState): string {
  return state.running.length
    ? `I'll restart once ${restartBlocker(state)!.replace(/ (is|are) still running$/, "")} ${state.running.length === 1 ? "has" : "have"} finished.`
    : "I'll restart as soon as this reply ends.";
}

/** Said once when a restart has waited too long: what's blocking it, and what Dan can do. */
export function stillBlockedMessage(state: RestartState): string {
  return `I still haven't restarted: ${restartBlocker(state) ?? "something is holding me up"}. I'll keep waiting; to restart straight away, quit me and reopen Astra.`;
}
