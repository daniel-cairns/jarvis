/**
 * Astra operating Mac apps: reads the screen through the Accessibility tree (native/astra-ax.swift) and acts with
 * clicks, typing, keys and scrolling, behind the safety rules in ./safety.ts. Every action is logged, shows the
 * on-screen "Astra is controlling your Mac" indicator while it runs, and can be halted by the stop switch.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirmationReason, elementLabel, isSecureField, normaliseCombo, StopSwitch, typingChunks, type ControlAction, type UiElement } from "./safety.js";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../native/astra-ax.swift");

export const SETTINGS_PANES = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

/** Runs the helper once; resolves with its JSON, rejects with its error message. */
export type Helper = (command: string, input?: Record<string, unknown> | string, signal?: AbortSignal) => Promise<any>;

export type ComputerHooks = {
  /** Asks Dan on a card; true only for a clear yes. */
  confirm(question: string): Promise<boolean>;
  /** One line for the log file and the transcript. */
  log(line: string): void;
  /** Turns the on-screen "controlling your Mac" indicator on or off. */
  indicator(on: boolean): void;
  /** Opens a URL or app (for the System Settings panes). */
  open(target: string): Promise<void>;
  /** Astra's own process ids (her orb and its windows), which never count as the app she's working in. */
  ownPids?(): number[];
};

/** Builds the helper from source if it's missing or older than the source, and returns a runner for it. */
export function nativeHelper(binDir: string): Helper {
  const bin = path.join(binDir, "astra-ax");
  let building: Promise<void> | null = null;
  const build = () =>
    (building ??= new Promise<void>((resolve, reject) => {
      if (existsSync(bin) && statSync(bin).mtimeMs >= statSync(SOURCE).mtimeMs) return resolve();
      mkdirSync(binDir, { recursive: true });
      execFile("swiftc", ["-O", "-swift-version", "5", SOURCE, "-o", bin], { timeout: 180_000 }, (err, _out, stderr) =>
        err ? reject(new Error(`couldn't build the control helper (needs Xcode's command-line tools): ${stderr || err.message}`)) : resolve(),
      );
    }).finally(() => (building = null)));
  return async (command, input, signal) => {
    await build();
    const arg = input === undefined ? [] : [typeof input === "string" ? input : JSON.stringify(input)];
    return new Promise((resolve, reject) => {
      execFile(bin, [command, ...arg], { timeout: 30_000, signal, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        let parsed: any;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          return reject(err ?? new Error(`the control helper said: ${stdout.slice(0, 200)}`));
        }
        if (parsed?.error) return reject(Object.assign(new Error(parsed.error), { code: parsed.code }));
        resolve(parsed);
      });
    });
  };
}

export class ComputerControl {
  readonly stopper = new StopSwitch();
  private indicatorOff?: NodeJS.Timeout;
  /** The app (pid) Astra last focused a field in: typing and keys refuse to go anywhere else. */
  private target?: number;
  /** The last app other than Astra's own windows that was in front while she acted: where the keyboard goes back to. */
  private lastApp?: number;

  constructor(
    private readonly helper: Helper,
    private readonly hooks: ComputerHooks,
    private readonly shots = path.join(os.tmpdir(), "astra-shots"),
  ) {}

  /** Halts the action in progress and refuses more until Dan's next request. */
  stop(): void {
    if (!this.stopper.stopped) this.hooks.log("Stopped controlling the Mac.");
    this.stopper.stop();
    this.indicatorNow(false);
  }

  resume(): void {
    this.stopper.resume();
  }

  /** Whether the helper has the permissions it needs; opens the right System Settings pane for whatever is missing. */
  async permissions(need: "accessibility" | "screenRecording" | "both" = "both", guide = true): Promise<{ ok: boolean; message: string }> {
    const p = (await this.helper("perms", guide ? "prompt" : undefined)) as { accessibility: boolean; screenRecording: boolean };
    const missing = (["accessibility", "screenRecording"] as const).filter((k) => (need === "both" || need === k) && !p[k]);
    if (!missing.length) return { ok: true, message: "Accessibility and Screen Recording are both allowed." };
    if (guide) await this.hooks.open(SETTINGS_PANES[missing[0]!]);
    const names = { accessibility: "Accessibility", screenRecording: "Screen Recording" };
    const app = process.stdin.isTTY ? "Terminal (the app you started Astra from)" : "Astra";
    return {
      ok: false,
      message:
        `I need ${missing.map((m) => names[m]).join(" and ")} permission to do that. ` +
        (guide ? `I've opened System Settings at Privacy & Security → ${names[missing[0]!]}. ` : "") +
        `Turn on ${app} there (add it with + if it isn't listed). ` +
        (missing.includes("screenRecording") ? "Screen Recording takes effect after Astra restarts." : "Then ask me again."),
    };
  }

  /** Runs one action: stop check, permission check, confirmation if needed, the indicator and the log. */
  private async act<T>(description: string, action: ControlAction | null, run: (signal: AbortSignal) => Promise<T>): Promise<T | string> {
    this.stopper.check();
    const perms = await this.permissions("accessibility");
    if (!perms.ok) return perms.message;
    if (action) {
      const reason = confirmationReason(action);
      if (reason) {
        this.hooks.log(`Asking before: ${description} (${reason})`);
        const yes = await this.hooks.confirm(`Astra wants to ${description}. Allow? (${reason})`);
        this.stopper.check();
        if (!yes) {
          this.hooks.log(`Dan declined: ${description}`);
          return `Dan said no, so I didn't ${description}.`;
        }
        // Answering the card brought the orb to the front; hand the keyboard back to the app she was working in.
        if (this.target) await this.helper("activate", { pid: this.target }).catch(() => undefined);
      }
    }
    this.hooks.log(description);
    await this.noteFront();
    this.indicatorNow(true);
    try {
      return await run(this.stopper.signal);
    } catch (err) {
      if (this.stopper.stopped) this.stopper.check();
      throw err;
    } finally {
      clearTimeout(this.indicatorOff);
      this.indicatorOff = setTimeout(() => this.indicatorNow(false), 2500);
    }
  }

  /** Remembers the app in front, unless it's Astra herself (her orb or a card Dan just answered). */
  private async noteFront(): Promise<void> {
    const front = (await this.helper("front").catch(() => null)) as { pid?: number } | null;
    if (front?.pid && !this.isOwn(front.pid)) this.lastApp = front.pid;
  }

  private isOwn(pid: number): boolean {
    return (this.hooks.ownPids?.() ?? []).includes(pid);
  }

  /**
   * Before typing or a key press: if one of Astra's own windows is in front (Dan just clicked a card, which makes her
   * the active app), hand the keyboard back to the app she was working in. Without this the keys were refused with
   * "nothing in Electron has keyboard focus", or worse, typed into her.
   */
  private async refocus(signal: AbortSignal): Promise<void> {
    const back = this.target ?? this.lastApp;
    if (!back) return;
    const front = (await this.helper("front", undefined, signal).catch(() => null)) as { pid?: number } | null;
    if (front?.pid && this.isOwn(front.pid)) await this.helper("activate", { pid: back }, signal).catch(() => undefined);
  }

  private indicatorNow(on: boolean): void {
    clearTimeout(this.indicatorOff);
    this.hooks.indicator(on);
  }

  async windows(): Promise<unknown> {
    return this.helper("windows");
  }

  /** The UI tree of an app (default: the frontmost), focused window or whole app. */
  /** Reads an app's UI tree. `pid` (or a numeric `app`) picks one exact copy when several are running. */
  async readUi(opts: { app?: string; pid?: number; scope?: "window" | "app"; depth?: number; max?: number } = {}): Promise<unknown> {
    this.stopper.check();
    const perms = await this.permissions("accessibility");
    if (!perms.ok) return perms.message;
    let pid: number | undefined;
    if (opts.pid || opts.app) pid = ((await this.helper("activate", { name: opts.app ?? "", pid: opts.pid })) as { pid: number }).pid;
    return this.helper("tree", { pid, scope: opts.scope ?? "window", depth: opts.depth ?? 12, max: opts.max ?? 400 });
  }

  /** A PNG of the whole screen, a region, or a window (by windowId from windows()). */
  async screenshot(opts: { region?: { x: number; y: number; width: number; height: number }; windowId?: number } = {}): Promise<{ png: Buffer } | string> {
    this.stopper.check();
    const perms = await this.permissions("screenRecording");
    if (!perms.ok) return perms.message;
    mkdirSync(this.shots, { recursive: true });
    const file = path.join(this.shots, `shot-${Date.now()}.png`);
    const args = ["-x", "-t", "png"];
    if (opts.windowId) args.push("-l", String(opts.windowId));
    else if (opts.region) args.push("-R", [opts.region.x, opts.region.y, opts.region.width, opts.region.height].map(Math.round).join(","));
    await new Promise<void>((res, rej) => execFile("screencapture", [...args, file], (e) => (e ? rej(e) : res())));
    // Keep it a sensible size for the model.
    await new Promise<void>((res) => execFile("sips", ["-Z", "1600", file], () => res()));
    const png = readFileSync(file);
    rmSync(file, { force: true });
    this.hooks.log(`Took a screenshot${opts.windowId ? ` of window ${opts.windowId}` : opts.region ? " of a region" : ""}.`);
    return { png };
  }

  /** Presses an element from readUi by its ref (falls back to clicking its centre). */
  async press(ref: string): Promise<unknown> {
    const target = (await this.helper("describe", { ref })) as UiElement;
    if (isSecureField(target)) return "That's a password field. I don't touch those; you'll need to do it yourself.";
    const name = elementLabel(target) || target.role || "element";
    return this.act(`press "${name}" in ${target.app ?? "the app"}`, { kind: "press", target }, (signal) => this.helper("press", { ref }, signal));
  }

  /** Clicks at screen coordinates (points, top-left origin). */
  async click(x: number, y: number, count = 1, right = false): Promise<unknown> {
    const target = (await this.helper("at", { x, y }).catch(() => undefined)) as UiElement | undefined;
    const name = elementLabel(target) || target?.role || `${Math.round(x)},${Math.round(y)}`;
    const verb = right ? "right-click" : count === 2 ? "double-click" : "click";
    // A click can land in any app, so typing afterwards goes wherever it put focus.
    this.target = undefined;
    return this.act(`${verb} "${name}"${target?.app ? ` in ${target.app}` : ""}`, { kind: "click", target }, (signal) =>
      this.helper("click", { x, y, count, right }, signal),
    );
  }

  /**
   * Types text into the focused element, a piece at a time so "stop" can halt it. Refuses password fields, and
   * stops rather than typing blind if the app in front isn't the one she focused (the helper checks every piece).
   * Reports what actually landed when the field's text can be read back.
   */
  async type(text: string): Promise<unknown> {
    const focused = (await this.helper("focused").catch(() => undefined)) as UiElement | undefined;
    if (isSecureField(focused)) return "The focused field is a password field. I never type into those; please do it yourself.";
    const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    const pid = this.target;
    return this.act(`type "${preview}"${focused?.app ? ` in ${focused.app}` : ""}`, { kind: "type", text, focused }, async (signal) => {
      await this.refocus(signal);
      let typed = 0;
      let missed = 0;
      let app = focused?.app;
      for (const piece of typingChunks(text)) {
        this.stopper.check();
        try {
          if (piece === "\n") await this.helper("key", { combo: "return", pid }, signal);
          else {
            const done = (await this.helper("type", { text: piece, pid }, signal)) as { app?: string; landed?: boolean };
            app = done?.app ?? app;
            if (done?.landed === false) missed += piece.length;
          }
        } catch (err) {
          if ((err as { code?: string }).code !== "wrong_target") throw err;
          return `Stopped after ${typed} of ${text.length} characters: ${(err as Error).message}`;
        }
        typed += piece.length;
      }
      if (missed) {
        return `I sent ${typed} characters to ${app ?? "the app"}, but ${missed} of them didn't show up in the field. Read the UI to see what's there before trying again.`;
      }
      return { typed, app };
    });
  }

  /** Presses a key combo, e.g. "cmd+b", "return", "shift+tab". */
  async key(combo: string): Promise<unknown> {
    const normal = normaliseCombo(combo);
    const focused = (await this.helper("focused").catch(() => undefined)) as UiElement | undefined;
    const pid = this.target;
    return this.act(`press ${normal}${focused?.app ? ` in ${focused.app}` : ""}`, { kind: "key", combo: normal, focused }, async (signal) => {
      await this.refocus(signal);
      try {
        return await this.helper("key", { combo: normal, pid }, signal);
      } catch (err) {
        if ((err as { code?: string }).code !== "wrong_target") throw err;
        return (err as Error).message;
      }
    });
  }

  async scroll(dy: number, dx = 0, at?: { x: number; y: number }): Promise<unknown> {
    return this.act(`scroll ${dy < 0 ? "down" : "up"}`, null, (signal) => this.helper("scroll", { dy, dx, ...at }, signal));
  }

  /** Moves keyboard focus to an element from readUi. */
  async focus(ref: string): Promise<unknown> {
    const target = (await this.helper("describe", { ref })) as UiElement;
    if (isSecureField(target)) return "That's a password field. I don't touch those.";
    return this.act(`focus "${elementLabel(target) || target.role}"`, { kind: "focus", target }, async (signal) => {
      const done = await this.helper("focus", { ref }, signal);
      // Refs start with the app's pid: typing now has to go there or nowhere.
      this.target = Number(ref.split("/")[0]) || undefined;
      return done;
    });
  }

  /** Opens (launching if need be) and brings an app to the front. */
  async openApp(name: string, pid?: number): Promise<unknown> {
    this.target = undefined;
    if (pid) return this.act(`bring pid ${pid} to the front`, { kind: "focus", target: { app: name } }, (signal) => this.helper("activate", { name, pid }, signal));
    return this.act(`open ${name}`, { kind: "focus", target: { app: name } }, async (signal) => {
      await this.hooks.open(name);
      for (let i = 0; i < 20; i++) {
        this.stopper.check();
        const done = await this.helper("activate", { name }, signal).catch(() => null);
        if (done) return done;
        await new Promise((r) => setTimeout(r, 250));
      }
      return `Opened ${name}, but it hasn't come to the front yet.`;
    });
  }
}
