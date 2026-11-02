/**
 * macOS actions: open apps, open files Astra built, and start a throwaway Chrome for REA to observe.
 * Every command goes through execFile/spawn with an argument array — never a shell string.
 */
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Runner = {
  run(cmd: string, args: string[]): Promise<void>;
  /** Starts a process that outlives Astra; returns its pid when known. */
  launchDetached(cmd: string, args: string[]): number | undefined | void;
};

export const realRunner: Runner = {
  async run(cmd, args) {
    await execFileAsync(cmd, args, { timeout: 15_000 });
  },
  launchDetached(cmd, args) {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return child.pid;
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

/** Checks on DevTools ports: which are free, and which process is listening on one. */
export type PortProbe = {
  isFree(port: number): Promise<boolean>;
  /** The pid listening on the port, if any. */
  owner(port: number): Promise<number | undefined>;
  /** Ends a launch that never came up properly. */
  kill(pid: number): void;
};

export const realProbe: PortProbe = {
  isFree: (port) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    }),
  owner: async (port) => {
    try {
      const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeout: 5_000 });
      const pid = Number(stdout.trim().split("\n")[0]);
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined; // lsof exits 1 when nothing is listening
    }
  },
  kill: (pid) => {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  },
};

/** How many ports past the configured one to try, and how long Chrome gets to open its DevTools port. */
const PORT_TRIES = 20;
const READY_MS = 15_000;

/**
 * Starts Chrome with a fresh temporary profile and a DevTools port, so REA observes a clean browser
 * with none of your logins, cookies or extensions in it.
 *
 * An earlier clean Chrome may still hold the usual port. Chrome then starts without DevTools and says nothing, and
 * REA silently attached to the old browser instead. So: take the first free port from `opts.port` up, and only
 * return once this Chrome's own pid is listening on it. The pid and endpoint come back together.
 */
export async function launchCleanBrowser(
  rawUrl: string,
  opts: { chromeBin: string; port: number; readyMs?: number },
  runner: Runner = realRunner,
  platform = process.platform,
  probe: PortProbe = realProbe,
): Promise<{ cdp_endpoint: string; port: number; pid: number; profileDir: string; url: string }> {
  requireMac(platform);
  const url = validateWebUrl(rawUrl);
  let port: number | undefined;
  for (let p = opts.port; p < opts.port + PORT_TRIES; p++) {
    if (await probe.isFree(p)) {
      port = p;
      break;
    }
  }
  if (port === undefined) throw new Error(`No free DevTools port between ${opts.port} and ${opts.port + PORT_TRIES - 1}; close some clean browsers first.`);
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-chrome-"));
  const pid = runner.launchDetached(opts.chromeBin, [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Chrome only builds the page's accessibility tree for screen readers, and ignores the switches other apps
    // honour (AXManualAccessibility, AXEnhancedUserInterface). Without this the page is one empty group to Astra.
    "--force-renderer-accessibility",
    url,
  ]);
  if (!pid) throw new Error("Chrome didn't start.");
  const deadline = Date.now() + (opts.readyMs ?? READY_MS);
  let owner: number | undefined;
  while (Date.now() < deadline) {
    owner = await probe.owner(port);
    if (owner !== undefined) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (owner !== pid) {
    probe.kill(pid);
    throw new Error(
      owner === undefined
        ? `Chrome never opened its DevTools port ${port}, so I closed it rather than hand REA a dead endpoint.`
        : `Port ${port} belongs to another process (pid ${owner}), not the Chrome I started; I closed mine rather than point REA at the wrong browser.`,
    );
  }
  // The pid lets the computer_* tools target this Chrome and never Dan's own.
  return { cdp_endpoint: `http://127.0.0.1:${port}`, port, pid, profileDir, url };
}
