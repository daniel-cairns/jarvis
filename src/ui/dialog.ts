/**
 * Native macOS approval pop-up (osascript `display dialog`), so you can approve without finding the terminal.
 * Text goes in through argv, never spliced into the AppleScript source.
 */
import { spawn } from "node:child_process";
import type { Answer } from "../permissions.js";

const SCRIPT = [
  "on run argv",
  "activate",
  'set r to display dialog (item 2 of argv) with title (item 1 of argv) buttons {"No", "Always", "Yes"} ' +
    'default button "Yes" cancel button "No" with icon note giving up after ((item 3 of argv) as integer)',
  'if gave up of r then return "timeout"',
  "return button returned of r",
  "end run",
];

/** Maps osascript's result to an answer; null means no answer (timed out, or the dialog couldn't show). */
export function parseDialogResult(code: number | null, stdout: string, stderr: string): Answer | null {
  if (code === 0) {
    const button = stdout.trim().toLowerCase();
    if (button === "yes" || button === "always" || button === "no") return button;
    return null;
  }
  // Pressing No (the cancel button) or Escape surfaces as error -128.
  return stderr.includes("-128") ? "no" : null;
}

/** Shows the approval pop-up. Resolves null if aborted, timed out, or not on macOS. */
export function askDialog(
  detail: string,
  signal: AbortSignal,
  opts: { title?: string; timeoutSec?: number; platform?: NodeJS.Platform } = {},
): Promise<Answer | null> {
  if ((opts.platform ?? process.platform) !== "darwin" || signal.aborted) return Promise.resolve(null);
  const args = SCRIPT.flatMap((line) => ["-e", line]);
  args.push(opts.title ?? "Jarvis wants to…", detail, String(opts.timeoutSec ?? 600));
  return new Promise((resolve) => {
    const child = spawn("osascript", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const onAbort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      signal.removeEventListener("abort", onAbort);
      resolve(signal.aborted ? null : parseDialogResult(code, stdout, stderr));
    });
  });
}
