/**
 * The rules Astra follows when operating Mac apps: what she must never touch (password fields), what she must ask
 * Dan about first (anything that sends, buys, deletes, submits, or changes system settings), and the stop switch
 * that halts an action in progress. Pure, so it can be tested without a Mac.
 */

/** One element as the helper describes it (native/astra-ax.swift). */
export type UiElement = {
  role?: string;
  subrole?: string;
  title?: string;
  label?: string;
  value?: unknown;
  placeholder?: string;
  secure?: boolean;
  app?: string;
  parent?: UiElement;
};

/** A password field: never read, never typed into. */
export function isSecureField(el: UiElement | undefined): boolean {
  if (!el) return false;
  return el.secure === true || el.role === "AXSecureTextField" || el.subrole === "AXSecureTextField";
}

/** The words on an element (or its parent, for an icon inside a labelled button) that say what it does. */
export function elementLabel(el: UiElement | undefined): string {
  if (!el) return "";
  const own = [el.title, el.label, typeof el.value === "string" && el.role === "AXButton" ? el.value : undefined]
    .filter((s): s is string => typeof s === "string" && !!s.trim())
    .join(" ");
  return own || (el.parent ? elementLabel({ ...el.parent, parent: undefined }) : "");
}

const RISKY =
  /\b(send|send now|buy|buy now|purchase|pay|checkout|check out|place order|order now|delete|remove|erase|trash|move to (the )?bin|empty (the )?(trash|bin)|discard|submit|confirm|post|publish|tweet|transfer|subscribe|unsubscribe|install|uninstall|reset|sell|donate|book now|sign up|log ?out|sign out)\b/i;

/** Apps where any action changes how the Mac itself is set up. */
const SETTINGS_APPS = /^(system settings|system preferences|keychain access|disk utility|migration assistant)$/i;
/** Apps where pressing Return runs a command. */
const SHELL_APPS = /^(terminal|iterm2?|warp|ghostty|kitty|alacritty)$/i;

export type ControlAction =
  | { kind: "press" | "click"; target?: UiElement }
  | { kind: "type"; text: string; focused?: UiElement }
  | { kind: "key"; combo: string; focused?: UiElement }
  | { kind: "scroll" | "focus"; target?: UiElement };

/** Normalises a key combo ("Cmd + Return" → "cmd+return"), with modifiers in a fixed order. */
export function normaliseCombo(combo: string): string {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const alias: Record<string, string> = { command: "cmd", option: "alt", opt: "alt", control: "ctrl", backspace: "delete", esc: "escape" };
  const named = parts.map((p) => alias[p] ?? p);
  const mods = ["ctrl", "alt", "shift", "cmd"].filter((m) => named.includes(m));
  return [...mods, ...named.filter((p) => !mods.includes(p))].join("+");
}

/**
 * Why Dan must confirm this action first, or null if it's fine to go ahead. Errs towards asking: a false alarm
 * costs a tap, a missed one could send an email or spend money.
 */
export function confirmationReason(action: ControlAction): string | null {
  const el = "target" in action ? action.target : "focused" in action ? action.focused : undefined;
  const app = el?.app ?? "";
  if (SETTINGS_APPS.test(app)) return `it changes system settings (${app})`;

  if (action.kind === "press" || action.kind === "click") {
    const label = elementLabel(action.target);
    const word = label.match(RISKY)?.[0];
    if (word) return `"${label}" looks like it would ${word.toLowerCase()} something`;
    return null;
  }
  if (action.kind === "key") {
    const combo = normaliseCombo(action.combo);
    if (/^(cmd\+(return|enter)|shift\+cmd\+d)$/.test(combo)) return `${combo} usually sends`;
    if (/^(cmd|alt\+cmd|shift\+cmd)\+delete$/.test(combo)) return `${combo} deletes`;
    if (combo === "return" || combo === "enter") {
      if (SHELL_APPS.test(app)) return `Return runs the command in ${app}`;
      // A single-line field submits its form on Return; a search box or a text area doesn't.
      if (action.focused?.role === "AXTextField" && action.focused.subrole !== "AXSearchField") return "Return would submit the form";
    }
    return null;
  }
  if (action.kind === "type" && /[\r\n]/.test(action.text)) {
    return confirmationReason({ kind: "key", combo: "return", focused: action.focused });
  }
  return null;
}

/** Raised when Dan says stop (or presses the stop hotkey) while Astra is operating the Mac. */
export class StoppedError extends Error {
  constructor() {
    super("Stopped: Dan halted control of the Mac. Don't continue unless he asks again.");
  }
}

/**
 * The stop switch. stop() halts the action in progress (its signal aborts, and the next checkpoint throws) and
 * refuses further actions until resume(), which happens when Dan makes a new request.
 */
export class StopSwitch {
  private controller = new AbortController();
  private halted = false;

  get stopped(): boolean {
    return this.halted;
  }

  /** The signal for the action starting now; aborts on stop(). */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  stop(): void {
    this.halted = true;
    this.controller.abort();
  }

  resume(): void {
    this.halted = false;
    if (this.controller.signal.aborted) this.controller = new AbortController();
  }

  /** Throws if stopped: call between the steps of an action. */
  check(): void {
    if (this.halted) throw new StoppedError();
  }
}

/** Splits text into short pieces (and lines), so typing can stop between pieces. Newlines become "\n" items. */
export function typingChunks(text: string, size = 24): string[] {
  const out: string[] = [];
  text.split(/(\r?\n)/).forEach((part) => {
    if (/^\r?\n$/.test(part)) return void out.push("\n");
    for (let i = 0; i < part.length; i += size) out.push(part.slice(i, i + size));
  });
  return out;
}
