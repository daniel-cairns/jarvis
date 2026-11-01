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
  "move",
] as const;
export type UiAction = (typeof UI_ACTIONS)[number];
/** Where "move" can put the orb: a spot on screen, or a nudge in one direction. */
export const POSITIONS = [
  "top_left", "top", "top_right", "left", "centre", "right", "bottom_left", "bottom", "bottom_right",
  "nudge_left", "nudge_right", "nudge_up", "nudge_down",
] as const;
export type Position = (typeof POSITIONS)[number];

/** A UI action, with a level (0–100) for set_volume or a position for move. */
export type UiCommand = { action: UiAction; level?: number; position?: Position };

/**
 * Reads "move to the top left", "go to the centre", "move a bit left", "move up". Saying "to"/"corner"/"side"/
 * "centre" means a spot on screen; a bare direction means a nudge.
 */
export function parseMove(s: string): Position | null {
  if (!/^(move|go|slide|drag|float|shift)( yourself| over)?\b/.test(s)) return null;
  const vertical = /\b(top|upper|up)\b/.test(s) ? "top" : /\b(bottom|lower|down)\b/.test(s) ? "bottom" : "";
  const horizontal = /\bleft\b/.test(s) ? "left" : /\bright\b/.test(s) ? "right" : "";
  const centre = /\b(centre|center|middle)\b/.test(s);
  const absolute = centre || /\b(to|into|corner|side|edge)\b/.test(s);
  if (!absolute) {
    if (horizontal && !vertical) return `nudge_${horizontal}`;
    if (vertical && !horizontal) return vertical === "top" ? "nudge_up" : "nudge_down";
    if (!vertical && !horizontal) return null;
  }
  if (vertical && horizontal) return `${vertical}_${horizontal}`;
  if (vertical) return vertical;
  if (horizontal) return horizontal;
  return centre ? "centre" : null;
}

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
  const position = parseMove(s.replace(/\b(please|a bit|a little|slightly|the screen|of the screen)\b/g, " ").replace(/\s+/g, " ").trim());
  if (position) return { action: "move", position };
  return null;
}
