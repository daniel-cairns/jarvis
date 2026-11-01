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
  type Runner,
} from "../src/tools/mac.js";

function fakeRunner() {
  const calls: { cmd: string; args: string[]; detached: boolean }[] = [];
  const runner: Runner = {
    async run(cmd, args) {
      calls.push({ cmd, args, detached: false });
    },
    launchDetached(cmd, args) {
      calls.push({ cmd, args, detached: true });
    },
  };
  return { runner, calls };
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
    const { runner, calls } = fakeRunner();
    const res = await launchCleanBrowser("https://igloo.inc", { chromeBin: "/chrome", port: 9333 }, runner, "darwin");
    expect(res.endpoint).toBe("http://127.0.0.1:9333");
    expect(calls[0]?.detached).toBe(true);
    expect(calls[0]?.args).toContain("--remote-debugging-port=9333");
    expect(calls[0]?.args).toContain("--remote-debugging-address=127.0.0.1");
    expect(calls[0]?.args).toContain(`--user-data-dir=${res.profileDir}`);
    expect(calls[0]?.args.at(-1)).toBe("https://igloo.inc/");
    await fs.rm(res.profileDir, { recursive: true, force: true });
  });

  it("rejects non-web URLs", () => {
    expect(() => validateWebUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => validateWebUrl("javascript:alert(1)")).toThrow(/http/);
    expect(() => validateWebUrl("not a url")).toThrow(/valid URL/);
  });
});
