/**
 * Everything Astra can do on the spot, in one list. Her help text, her ui_control tool's description and the "What
 * you can do" part of her instructions are all built from it, and the tests check that every phrase here is one her
 * quick commands really hear, that every ui_control action and every typed command is listed, so they can't drift
 * apart again (demo mode was in two of the four places, so she said she had none and paid a session to build one).
 */
import type { UiAction } from "./ui/control.js";

export type Ability = {
  /** What it's called, for her and the help text. */
  name: string;
  /** What it does: one or two plain sentences, written to her. */
  what: string;
  /** Things Dan can say that do it straight away, without a round trip to Claude (tested). */
  say?: readonly string[];
  /** The typed command, if there is one (with its arguments, e.g. "/god on|off"). */
  slash?: string;
  /** Her ui_control action, if she can do it herself. */
  ui?: UiAction | readonly UiAction[];
};

export const ABILITIES: readonly Ability[] = [
  // Conversation
  { name: "New conversation", what: "Start afresh, forgetting this conversation.", say: ["new conversation", "start fresh"], slash: "/new" },
  {
    name: "Pick up the last conversation",
    what: "Resume the previous conversation after a restart. Only when Dan asks; it resumes once this reply ends.",
    say: ["pick up where we left off", "continue the last conversation"],
    slash: "/continue",
    ui: "continue_session",
  },
  { name: "Tell me more", what: "Read the next part of a long reply, or the panel you just opened.", say: ["more", "tell me more"], slash: "/more" },
  { name: "Stop", what: "Stop talking and working at once. Anyone's bare \"stop\" counts.", say: ["stop", "be quiet"], ui: "stop" },
  { name: "Help", what: "List the commands.", say: ["help", "what can you do"], slash: "/help" },
  // Voice and modes
  {
    name: "Type only",
    what: "Microphone off and silent: replies on screen only. Voice mode switches back.",
    say: ["type only", "voice mode"],
    slash: "/type, /voice",
    ui: ["type_only", "voice_mode"],
  },
  { name: "Mute", what: "Keep listening but caption replies instead of speaking them.", say: ["mute", "unmute"], slash: "/mute, /unmute" },
  { name: "Wake word", what: "Turn listening for \"Astra\" off or on.", say: ["turn off the wake word"], slash: "/wake on|off" },
  {
    name: "Volume",
    what: "Change your speaking volume: volume_up, volume_down, or set_volume with a level from 0 to 100.",
    say: ["louder", "quieter", "volume 40"],
    ui: ["volume_up", "volume_down", "set_volume"],
  },
  {
    name: "Learn my voice",
    what: "Dan reads five sentences from a panel, and from then on you only act on his voice. \"Forget my voice\" undoes it.",
    say: ["learn my voice", "forget my voice"],
    slash: "/voiceprint, /voiceprint off",
  },
  {
    name: "Transcript",
    what: "Record everything said until Dan says \"stop recording\", then save it to the brain under transcripts. It starts once this reply ends.",
    say: ["start a transcript called standup"],
    slash: "/transcript [title]",
    ui: "start_transcript",
  },
  {
    name: "God mode",
    what: "You command Dan's sessions: hand project work to them and announce when they finish. Shown by a crown and a gold halo on the orb.",
    say: ["god mode on", "god mode off"],
    slash: "/god on|off",
    ui: ["god_mode_on", "god_mode_off"],
  },
  {
    name: "Demo",
    what:
      "A narrated tour of about three minutes of every state, glyph, card and panel you have, with made-up data, so it's safe to show anyone. Built in: never hand building a demo to a session. It starts once this reply ends, so say only a few words first.",
    say: ["demo mode", "give me a tour", "show off"],
    slash: "/demo",
    ui: "demo",
  },
  // What's going on
  {
    name: "Sit rep",
    what: "A panel of every session, with a summary returned for you to tell Dan.",
    say: ["sit rep", "what's everyone up to"],
    slash: "/sitrep",
    ui: "sitrep",
  },
  { name: "On my plate", what: "Dan's open loops on screen, with a one-line summary to tell him.", say: ["what's on my plate"], ui: "show_plate" },
  {
    name: "Sessions panel",
    what: "Every session and background run, kept up to date while it's open. Dan can open, read, message or stop them from it.",
    say: ["show my sessions"],
    ui: "show_sessions",
  },
  {
    name: "Tallyline",
    what: "Dan's work ledger: a compact panel with the active sprint, today's filed time and the latest issues, which expands to the full app. It starts Tallyline if needed.",
    say: ["show tallyline"],
    ui: "show_tallyline",
  },
  { name: "Brain", what: "Open the brain browser: every note and teardown.", say: ["open my brain"], slash: "/brain", ui: "show_brain" },
  // Your windows
  {
    name: "Minimise and show",
    what: "Fold away into the menu bar (minimise), or unfold back (show).",
    say: ["minimise", "come back"],
    ui: ["minimise", "show"],
  },
  {
    name: "Move",
    what: "Move yourself on screen: move with a position, a spot like top_left or centre, or a nudge_left, nudge_right, nudge_up or nudge_down.",
    say: ["move to the top left", "move left"],
    ui: "move",
  },
  {
    name: "Thinking window",
    what: "Collapse or expand your thinking window.",
    say: ["collapse your thinking window", "expand your thinking window"],
    ui: ["collapse_panel", "expand_panel"],
  },
  {
    name: "Terminal and git panels",
    what: "Show the commands you've run, or the code changes in Dan's repos.",
    say: ["show your terminal", "show git changes"],
    ui: ["show_terminal", "show_git"],
  },
  {
    name: "Reopen panels",
    what: "Bring back the last detail panel or map, or every panel from your last request.",
    say: ["show me the map again", "show your windows again"],
    ui: ["show_last_detail", "show_last_map", "reopen_windows"],
  },
  { name: "Close panels", what: "Close every panel; they stay closed until something shows one again.", say: ["close the panels"], ui: "close_panels" },
  {
    name: "Panels to the front",
    what: "Bring every open panel in front of other apps' windows (they're normal windows that other apps can cover).",
    say: ["bring the panels to the front"],
    ui: "panels_front",
  },
  {
    name: "Tidy windows",
    what: "Lay the panels out so none overlap, bringing back into the layout any Dan dragged or resized.",
    say: ["tidy up", "stack the windows"],
    slash: "/stack",
    ui: "stack_windows",
  },
  // You
  {
    name: "Restart",
    what: "Quit and start again with your latest code, once this reply and any background sessions you're running have finished.",
    say: ["restart yourself"],
    slash: "/restart",
    ui: "restart",
  },
  { name: "Quit", what: "Close Astra completely.", say: ["quit"], slash: "/quit" },
];

const actionsOf = (a: Ability): readonly UiAction[] => (a.ui === undefined ? [] : typeof a.ui === "string" ? [a.ui] : a.ui);

/** Her help text: every typed command, then how to stop her. */
export function helpText(): string {
  const commands = ABILITIES.filter((a) => a.slash).map((a) => `${a.slash} (${a.name.toLowerCase()})`);
  return `Say "Astra" to wake her. Commands: ${commands.join(", ")}. Ctrl-C or Esc on the orb stops her.`;
}

/** ui_control's description: every action she can take, with what it does. */
export function uiControlDescription(): string {
  const items = ABILITIES.filter((a) => a.ui).map((a) => `${a.name} (${actionsOf(a).join(" / ")}): ${a.what}`);
  return `Work your own interface when the user asks. Use this rather than shell commands to move your window. ${items.join(" · ")}`;
}

/** The part of her instructions that says what she can do, so she never says she can't do something she can. */
export function abilitiesSection(): string {
  const lines = ABILITIES.map((a) => {
    const how = [a.ui ? `ui_control ${actionsOf(a).join("/")}` : "", a.slash ? `typed ${a.slash}` : "", a.say?.length ? `Dan says "${a.say[0]}"` : ""]
      .filter(Boolean)
      .join("; ");
    return `- ${a.name} (${how}): ${a.what}`;
  });
  return `## What you can do on the spot\nThese are built in. Never say you can't do one, and never hand building one to a session.\n${lines.join("\n")}`;
}

export const uiActionsOf = actionsOf;
