import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CoffeeMode, type Spawner } from "../src/power/coffee.js";

function fakeSpawner() {
  const runs: { args: string[]; killed: boolean; exit: () => void }[] = [];
  const spawner: Spawner = (_cmd, args) => {
    let onExit = () => {};
    const run = { args, killed: false, exit: () => onExit() };
    runs.push(run);
    return { kill: () => (run.killed = true), on: (_e, l) => (onExit = l) };
  };
  return { spawner, runs };
}

const file = () => path.join(mkdtempSync(path.join(os.tmpdir(), "coffee-")), "coffee.json");
const NOW = Date.parse("2026-11-02T22:00:00Z");

describe("coffee mode", () => {
  it("runs caffeinate tied to Astra's pid, so it ends when she does", () => {
    const { spawner, runs } = fakeSpawner();
    const c = new CoffeeMode(file(), 4242, spawner, () => NOW);
    c.start();
    expect(runs[0]!.args).toEqual(["-dimsu", "-w", "4242"]);
    expect(c.on).toBe(true);
  });

  it("takes a timer in minutes and says when it ends", () => {
    const { spawner, runs } = fakeSpawner();
    const c = new CoffeeMode(file(), 1, spawner, () => NOW);
    expect(c.start(120)).toMatch(/for 2 h/);
    expect(runs[0]!.args).toEqual(["-dimsu", "-w", "1", "-t", "7200"]);
  });

  it("turns off, killing caffeinate and forgetting the state", () => {
    const { spawner, runs } = fakeSpawner();
    const f = file();
    const c = new CoffeeMode(f, 1, spawner, () => NOW);
    c.start();
    expect(c.stop()).toMatch(/off/);
    expect(runs[0]!.killed).toBe(true);
    expect(existsSync(f)).toBe(false);
    expect(c.status()).toBe("Coffee mode is off.");
  });

  it("carries on through a restart, with the time left", () => {
    const f = file();
    const first = fakeSpawner();
    const before = new CoffeeMode(f, 1, first.spawner, () => NOW);
    before.start(60);
    before.shutdown(true);
    const second = fakeSpawner();
    const after = new CoffeeMode(f, 2, second.spawner, () => NOW + 20 * 60_000);
    expect(after.resume()).toBe(true);
    expect(second.runs[0]!.args).toEqual(["-dimsu", "-w", "2", "-t", "2400"]);
  });

  it("ends with a quit, and doesn't resume once its time has run out", () => {
    const f = file();
    const c = new CoffeeMode(f, 1, fakeSpawner().spawner, () => NOW);
    c.start();
    c.shutdown(false);
    expect(new CoffeeMode(f, 1, fakeSpawner().spawner, () => NOW).resume()).toBe(false);
    const g = file();
    new CoffeeMode(g, 1, fakeSpawner().spawner, () => NOW).start(5);
    expect(new CoffeeMode(g, 1, fakeSpawner().spawner, () => NOW + 6 * 60_000).resume()).toBe(false);
  });

  it("notices when its timer runs out", () => {
    const { spawner, runs } = fakeSpawner();
    const changes: boolean[] = [];
    const c = new CoffeeMode(file(), 1, spawner, () => NOW);
    c.onChange = (on) => changes.push(on);
    c.start(1);
    runs[0]!.exit();
    expect(c.on).toBe(false);
    expect(changes).toEqual([true, false]);
  });
});
