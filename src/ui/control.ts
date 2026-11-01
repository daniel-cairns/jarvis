/** Astra working her own interface: the actions ui_control takes, and the quick spoken ones that skip Claude. */

export const UI_ACTIONS = [
  "minimise",
  "show",
  "stop",
  "close_panels",
  "show_last_detail",
  "show_last_map",
  "show_brain",
  "volume_up",
  "volume_down",
  "set_volume",
] as const;
export type UiAction = (typeof UI_ACTIONS)[number];
/** A UI action, with a level (0–100) for set_volume. */
export type UiCommand = { action: UiAction; level?: number };

/**
 * Plain spoken commands handled instantly, without a round trip to Claude ("Astra, minimise", "Astra, close the
 * map"). Anything less direct goes to her as a request and she uses ui_control.
 */
export function quickUiCommand(request: string): UiCommand | null {
  const level = request.match(/^\s*(?:set\s+)?(?:your\s+|the\s+)?volume\s+(?:to\s+)?(\d{1,3})\s*(?:%|percent)?\s*[.!]?\s*$/i);
  if (level) return { action: "set_volume", level: Math.min(100, Number(level[1])) };
  const s = request.toLowerCase().replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (/^(minimi[sz]e|hide|go away|tuck away)( yourself| the orb)?$/.test(s)) return { action: "minimise" };
  if (/^(show yourself|come back|unhide|appear|show the orb)$/.test(s)) return { action: "show" };
  if (/^close( the| all| all the)? (panels?|map|detail|windows?)$/.test(s)) return { action: "close_panels" };
  if (/^(open|show)( me)? (my |your |the )?brain$/.test(s)) return { action: "show_brain" };
  if (/^(show|open)( me)? the (last )?map( again)?$/.test(s)) return { action: "show_last_map" };
  if (/^(louder|speak up|volume up|turn (it|yourself) up|turn up( the volume)?)( please)?$/.test(s)) return { action: "volume_up" };
  if (/^(quieter|softer|volume down|turn (it|yourself) down|turn down( the volume)?)( please)?$/.test(s)) return { action: "volume_down" };
  return null;
}
