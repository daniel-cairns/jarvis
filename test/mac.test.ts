import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isInside,
  launchCleanBrowser,
  openApp,
  openPath,
  validateAppName,
  validateWebUrl,
  type PortProbe,
  type Runner,
} from "../src/tools/mac.js";

function fakeRunner(pid?: number) {
  const calls: { cmd: string; args: string[]; detached: boolean }[] = [];
  const runner: Runner = {
    async run(cmd, args) {
      calls.push({ cmd, args, detached: false });
    },
    launchDetached(cmd, args) {
      calls.push({ cmd, args, detached: true });
      return pid;
    },
  };
  return { runner, calls };
}

/** Ports in `taken` are busy (held by `stalePid`); the new Chrome listens on whatever port it was given. */
function fakeProbe(taken: number[], stalePid = 93900, launchedPid = 4242, opens = true) {
  const killed: number[] = [];
  let listening: number | undefined;
  const probe: PortProbe = {
    isFree: async (p) => !taken.includes(p),
    owner: async (p) => (taken.includes(p) ? stalePid : opens && p === listening ? launchedPid : undefined),
    kill: (p) => void killed.push(p),
  };
  return { probe, killed, listenOn: (p: number) => (listening = p) };
}

describe("validateAppName", () => {
  it("accepts real app names", () => {
    expect(validateAppName("Notes")).toBe("Notes");
    expect(validateAppName("Visual Studio Code.app")).toBe("Visual Studio Code");
    expect(validateAppName("Microsoft Word")).toBe("Microsoft Word");
  });

  it("rejects flags, paths and shell syntax", () => {
    for (const bad of ["-a Terminal", "../../bin/sh", "Notes; rm -rf ~", "$(whoami)", ""]) {
      expect(() => validateAppName(bad)).toThrow();
    }
  });
});

describe("openApp", () => {
  it("runs open -a with the name as a single argument", async () => {
    const { runner, calls } = fakeRunner();
    await openApp("Notes", runner, "darwin");
    expect(calls).toEqual([{ cmd: "open", args: ["-a", "Notes"], detached: false }]);
  });

  it("refuses on non-macOS", async () => {
    const { runner } = fakeRunner();
    await expect(openApp("Notes", runner, "linux")).rejects.toThrow(/macOS/);
  });
});

describe("openPath", () => {
  it("opens files inside allowed roots only", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ws-"));
    const file = path.join(root, "app", "index.html");
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, "<h1>hi</h1>");
    const { runner, calls } = fakeRunner();

    await openPath(file, [root], runner, "darwin");
    expect(calls[0]?.args).toEqual([file]);
    await expect(openPath("/etc/hosts", [root], runner, "darwin")).rejects.toThrow(/Refusing/);
    await expect(openPath(path.join(root, "..", "x"), [root], runner, "darwin")).rejects.toThrow(/Refusing/);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("isInside", () => {
  it("treats the root itself and siblings as outside", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(false);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
  });
});

describe("launchCleanBrowser", () => {
  it("starts Chrome with a temp profile and loopback DevTools port", async () => {
    const { runner, calls } = fakeRunner(4242);
    const p = fakeProbe([]);
    p.listenOn(9333);
    const res = await launchCleanBrowser("https://igloo.inc", { chromeBin: "/chrome", port: 9333 }, runner, "darwin", p.probe);
    expect(res.pid).toBe(4242);
    expect(res.cdp_endpoint).toBe("http://127.0.0.1:9333");
    expect(calls[0]?.detached).toBe(true);
    expect(calls[0]?.args).toContain("--remote-debugging-port=9333");
    expect(calls[0]?.args).toContain("--remote-debugging-address=127.0.0.1");
    expect(calls[0]?.args).toContain(`--user-data-dir=${res.profileDir}`);
    expect(calls[0]?.args.at(-1)).toBe("https://igloo.inc/");
    // Without it, Chrome shows Astra's computer_read_ui an empty page.
    expect(calls[0]?.args).toContain("--force-renderer-accessibility");
    await fs.rm(res.profileDir, { recursive: true, force: true });
  });

  it("skips a port an earlier clean Chrome still holds, and returns the new pid with its own endpoint", async () => {
    const { runner, calls } = fakeRunner(4242);
    const p = fakeProbe([9222, 9223]);
    p.listenOn(9224);
    const res = await launchCleanBrowser("https://jira.example.com", { chromeBin: "/chrome", port: 9222 }, runner, "darwin", p.probe);
    expect(calls[0]?.args).toContain("--remote-debugging-port=9224");
    expect(res).toMatchObject({ cdp_endpoint: "http://127.0.0.1:9224", port: 9224, pid: 4242 });
    await fs.rm(res.profileDir, { recursive: true, force: true });
  });

  it("refuses, and closes its Chrome, when the port turns out to belong to someone else", async () => {
    const { runner } = fakeRunner(4242);
    // Free when checked, then taken by the stale browser before ours could bind it.
    const p = fakeProbe([]);
    p.probe.owner = async () => 93900;
    await expect(launchCleanBrowser("https://jira.example.com", { chromeBin: "/chrome", port: 9222 }, runner, "darwin", p.probe)).rejects.toThrow(
      /belongs to another process \(pid 93900\)/,
    );
    expect(p.killed).toEqual([4242]);
  });

  it("refuses, and closes its Chrome, when it never opens the DevTools port", async () => {
    const { runner } = fakeRunner(4242);
    const p = fakeProbe([], 1, 4242, false);
    await expect(
      launchCleanBrowser("https://jira.example.com", { chromeBin: "/chrome", port: 9222, readyMs: 300 }, runner, "darwin", p.probe),
    ).rejects.toThrow(/never opened its DevTools port 9222/);
    expect(p.killed).toEqual([4242]);
  });

  it("rejects non-web URLs", () => {
    expect(() => validateWebUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => validateWebUrl("javascript:alert(1)")).toThrow(/http/);
    expect(() => validateWebUrl("not a url")).toThrow(/valid URL/);
  });
});
