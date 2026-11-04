import { isShowSessions } from "./sessionsPanel.js";
/** Astra working her own interface: the actions ui_control takes, and the quick spoken ones that skip Claude. */
import { parseTranscriptStart } from "../voice/transcript.js";

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
  "collapse_panel",
  "expand_panel",
  "show_terminal",
  "show_git",
  "start_transcript",
  "restart",
  "type_only",
  "voice_mode",
  "sitrep",
  "god_mode_on",
  "god_mode_off",
  "stack_windows",
  "reopen_windows",
  "panels_front",
  "continue_session",
  "show_sessions",
  "show_tallyline",
  "show_plate",
  "demo",
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
  if (/^(minimi[sz]e|hide|go away|tuck away|fold( yourself)? (up|away)|close yourself|close up|transform( closed?)?)( yourself| the orb)?$/.test(s)) {
    return { action: "minimise" };
  }
  if (/^(show yourself|come back|unhide|appear|show the orb|unfold( yourself)?|open up|open yourself|transform open)$/.test(s)) {
    return { action: "show" };
  }
  if (/^close( the| all| all the)? (panels?|map|detail|windows?)$/.test(s)) return { action: "close_panels" };
  if (/^(open|show)( me)? (my |your |the )?brain$/.test(s)) return { action: "show_brain" };
  if (/^(show|open)( me)? the (last )?map( again)?$/.test(s)) return { action: "show_last_map" };
  if (/^(louder|speak up|volume up|turn (it|yourself) up|turn up( the volume)?)( please)?$/.test(s)) return { action: "volume_up" };
  if (/^(quieter|softer|volume down|turn (it|yourself) down|turn down( the volume)?)( please)?$/.test(s)) return { action: "volume_down" };
  if (/^(collapse|minimi[sz]e|shrink|fold)( your| the)? (panel|thinking window|transmission( panel)?|card)$/.test(s)) return { action: "collapse_panel" };
  if (/^(expand|open|unfold|show)( your| the)? (panel|thinking window|transmission( panel)?|card)$/.test(s)) return { action: "expand_panel" };
  if (/^(show|open)( me)? (your |the )?(terminal|commands?|command log)$/.test(s)) return { action: "show_terminal" };
  if (/^(show|open)( me)? (your |the )?(git( changes)?|changes|diffs?|code changes)$/.test(s)) return { action: "show_git" };
  if (/^(restart|reboot|reload)( yourself)?( please)?$/.test(s)) return { action: "restart" };
  if (
    /^(continue|resume|pick up|carry on)( with)?( the| our| your| my)? (last|previous) (session|conversation|chat)$/.test(s) ||
    /^(pick up|carry on|continue|start again) (from )?where (we|you|i) left off$/.test(s)
  ) {
    return { action: "continue_session" };
  }
  if (/^(show|reopen|bring back|open)( me)?( all)?( your| my| the)?( recent| last| latest)? (windows|panels)( back| again)?$|^bring (your |the )?(windows|panels) back$/.test(s)) return { action: "reopen_windows" };
  if (/^(bring|pull|put)( all)?( of)?( your| the| my)? (windows|panels) (to the front|forward|on top)( please)?$/.test(s)) return { action: "panels_front" };
  if (/^(stack|arrange|tidy( up)?|organi[sz]e|line up|sort out)( all)?( your| the| my)? (windows|panels)( nicely)?( please)?$|^tidy up$/.test(s)) {
    return { action: "stack_windows" };
  }
  if (/^(go |switch to |turn on )?(type|typing|text) (only )?mode( on)?( please)?$|^type only( please)?$/.test(s)) return { action: "type_only" };
  if (isShowSessions(s)) return { action: "show_sessions" };
  if (/^(show|open|bring up|pull up)( me)?( the| my)? tallyline( panel)?$|^tallyline$/.test(s)) return { action: "show_tallyline" };
  if (/^(what s|what is|what have i got|show me|show)( on)? my plate$|^what s (waiting|pending) (on|for) me$|^what (am i|are we) waiting on$|^on my plate$/.test(s)) return { action: "show_plate" };
  if (/^(give me |get me |what s the |what is the )?(a |the |your )?(sit ?rep|situation report|status report)( please)?$|^what (s|is) everyone (doing|up to)$/.test(s)) return { action: "sitrep" };
  if (/^(go into |enter |switch to |turn on |activate )?god mode( on)?( please)?$/.test(s)) return { action: "god_mode_on" };
  if (/^(leave |exit |turn off |deactivate |end )god mode|^god mode off$/.test(s)) return { action: "god_mode_off" };
  if (/^(go |switch to |turn on |back to )?(voice|talking|speaking) mode( on)?( please)?$/.test(s)) return { action: "voice_mode" };
  const position = parseMove(s.replace(/\b(please|a bit|a little|slightly|the screen|of the screen)\b/g, " ").replace(/\s+/g, " ").trim());
  if (position) return { action: "move", position };
  return null;
}

// Polite and filler words around a command ("Astra, could you please stack the windows for me?").
const LEADING = /^(?:hey|hi|ok|okay|right|so|um+|uh+|astra|astrid|astro|please|just|now|and|can you|could you|would you|will you|go ahead and|i want you to|i need you to|i'd like you to|let's|lets)\s+/;
const TRAILING = /\s+(?:please|now|for me|thanks|thank you|astra|ok|okay|right now)$/;

// Things whisper often mishears in these commands.
const MISHEARD: [RegExp, string][] = [
  [/\b(?:sit|set|sat|said)\s*(?:rap|wrap|rep|reps|rip|ret|reb)\b/g, "sit rep"],
  [/\bgod mod\b/g, "god mode"],
  [/\bminimi[sz]ed\b/g, "minimise"],
  [/\b(?:windows|window's|winders)\b/g, "windows"],
  [/\btranscription\b/g, "transcript"],
];

/** A request reduced to its command words: lower case, no punctuation, fillers and common mishearings fixed. */
export function commandWords(request: string): string {
  let s = request.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
  for (const [from, to] of MISHEARD) s = s.replace(from, to);
  for (let before = ""; before !== s; ) {
    before = s;
    s = s.replace(LEADING, "").replace(TRAILING, "").trim();
  }
  return s;
}

// Spoken or typed versions of the slash commands.
const SLASH: [RegExp, string][] = [
  [/^(?:mute|mute yourself|stop talking out loud|go silent)$/, "/mute"],
  [/^(?:unmute|unmute yourself|you can talk again|talk to me again|speak again)$/, "/unmute"],
  [/^(?:new conversation|start (?:a )?(?:new|fresh) conversation|start fresh|fresh start|clear (?:the |our )?conversation)$/, "/new"],
  [/^(?:quit|exit|shut down|shut yourself down|turn yourself off|close yourself completely)$/, "/quit"],
  [/^(?:turn off|stop|disable) (?:the )?wake word$/, "/wake off"],
  [/^(?:help|what can you do|what are your commands|list (?:your )?commands)$/, "/help"],
  [/^(?:(?:start |run |go into |begin )?(?:the |your |a )?demo(?: mode)?|show off|show (?:me )?(?:what you can do|your tricks|everything you can do)|give (?:me )?(?:a|the) (?:demo|tour))$/, "/demo"],
  [/^(?:learn|enrol|enroll|train on|register|memori[sz]e|remember) (?:my|your) voice(?:print)?$|^only listen to (?:me|my voice)$/, "/voiceprint"],
  [/^(?:forget|delete|remove|clear) my voice(?:print)?$|^listen to (?:everyone|anyone)(?: again)?$/, "/voiceprint off"],
  // Only unmistakable asks: "go on" or "carry on" can mean "yes, do it".
  [/^(?:more|tell me more|say more|more detail|more details|what else|tell me the rest|the rest|and the rest)$/, "/more"],
];

export type LocalCommand = { ui: UiCommand } | { slash: string };

/**
 * Commands she handles on the spot, before anything goes to Claude: her interface controls and the slash commands,
 * however they're phrased around the edges. Null means it's a real request for her.
 */
export function localCommand(request: string): LocalCommand | null {
  if (request.trim().startsWith("/")) return null;
  const whole = wholeCommand(request);
  if (whole) return whole;
  // "That's really great. Demo mode.": a command said after a few words of something else. Only harmless ones:
  // a stray "...quit" or "...restart" at the end of a sentence about something else mustn't act.
  const said = request.trim().split(/(?<=[.!?])\s+/);
  if (said.length < 2 || said.slice(0, -1).join(" ").split(/\s+/).length > 8) return null;
  const last = wholeCommand(said.at(-1)!);
  if (!last) return null;
  const risky = "slash" in last ? RISKY_SLASH.has(last.slash) : RISKY_UI.has(last.ui.action);
  return risky ? null : last;
}

/** Commands that act too big to take from the tail of a longer sentence. */
const RISKY_SLASH = new Set(["/quit", "/new", "/mute", "/wake off", "/voiceprint", "/voiceprint off"]);
const RISKY_UI = new Set<UiAction>(["restart", "minimise", "close_panels", "type_only", "god_mode_on", "god_mode_off", "continue_session"]);

/** The request as a whole is one of her quick commands. */
function wholeCommand(request: string): LocalCommand | null {
  const words = commandWords(request);
  if (!words) return null;
  const ui = quickUiCommand(request) ?? quickUiCommand(words);
  if (ui) return { ui };
  const transcript = parseTranscriptStart(words);
  if (transcript) return { slash: `/transcript${transcript.title ? ` ${transcript.title}` : ""}` };
  for (const [pattern, slash] of SLASH) if (pattern.test(words)) return { slash };
  return null;
}

/**
 * "Stop", "cancel that", "be quiet": halt whatever she's doing. Only the bare command counts, so "stop s4" or "stop
 * coffee mode" still reach her as requests (they used to be swallowed as a plain stop).
 */
export function isStopCommand(request: string): boolean {
  const s = request.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return /^(stop|cancel|never ?mind|be quiet|quiet|shush|shut up|hush)( (it|that|this|talking|speaking|now|please|everything|there|right there|all of it))*$/.test(s);
}
