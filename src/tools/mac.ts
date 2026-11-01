/**
 * macOS actions: open apps, open files Astra built, and start a throwaway Chrome for REA to observe.
 * Every command goes through execFile/spawn with an argument array — never a shell string.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Runner = {
  run(cmd: string, args: string[]): Promise<void>;
  launchDetached(cmd: string, args: string[]): void;
};

export const realRunner: Runner = {
  async run(cmd, args) {
    await execFileAsync(cmd, args, { timeout: 15_000 });
  },
  launchDetached(cmd, args) {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  },
};

// Letters, digits, spaces and the punctuation real app names use. No leading dash, so it can't become a flag.
const APP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .&'()+_-]{0,79}$/u;

export function validateAppName(name: string): string {
  const trimmed = name.trim().replace(/\.app$/i, "");
  if (!APP_NAME.test(trimmed)) throw new Error(`"${name}" doesn't look like an app name`);
  return trimmed;
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function requireMac(platform: NodeJS.Platform): void {
  if (platform !== "darwin") throw new Error("This action only works on macOS");
}

export async function openApp(name: string, runner: Runner = realRunner, platform = process.platform): Promise<string> {
  requireMac(platform);
  const app = validateAppName(name);
  await runner.run("open", ["-a", app]);
  return `Opened ${app}`;
}

/** Opens a file or folder, but only inside Astra's own folders. */
export async function openPath(
  target: string,
  allowedRoots: string[],
  runner: Runner = realRunner,
  platform = process.platform,
): Promise<string> {
  requireMac(platform);
  const abs = path.resolve(target);
  if (!allowedRoots.some((root) => isInside(root, abs))) {
    throw new Error(`Refusing to open "${target}": only files inside ${allowedRoots.join(" or ")} can be opened`);
  }
  await fs.access(abs);
  await runner.run("open", [abs]);
  return `Opened ${abs}`;
}

export function validateWebUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https URLs are allowed");
  return url.toString();
}

/**
 * Starts Chrome with a fresh temporary profile and a DevTools port, so REA observes a clean browser
 * with none of your logins, cookies or extensions in it.
 */
export async function launchCleanBrowser(
  rawUrl: string,
  opts: { chromeBin: string; port: number },
  runner: Runner = realRunner,
  platform = process.platform,
): Promise<{ cdp_endpoint: string; profileDir: string; url: string }> {
  requireMac(platform);
  const url = validateWebUrl(rawUrl);
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-chrome-"));
  runner.launchDetached(opts.chromeBin, [
    `--remote-debugging-port=${opts.port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ]);
  return { cdp_endpoint: `http://127.0.0.1:${opts.port}`, profileDir, url };
}
