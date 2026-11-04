import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { watchBrain } from "../src/tools/brain.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("watchBrain", () => {
  it("calls back once after a burst of note changes settles, including in a subfolder", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "brain-"));
    mkdirSync(path.join(dir, "teardowns"));
    let calls = 0;
    const stop = watchBrain(dir, () => calls++, 150);
    await sleep(100);
    writeFileSync(path.join(dir, "teardowns", "signal.md"), "# Signal\n");
    writeFileSync(path.join(dir, "teardowns", "signal.md"), "# Signal\n\nMore.\n");
    await sleep(600);
    stop();
    expect(calls).toBe(1);
  });

  it("ignores files that aren't notes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "brain-"));
    let calls = 0;
    const stop = watchBrain(dir, () => calls++, 100);
    await sleep(100);
    writeFileSync(path.join(dir, ".DS_Store"), "x");
    await sleep(400);
    stop();
    expect(calls).toBe(0);
  });
});
