import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { Tallyline, type TallylineDeps } from "../src/tools/tallyline.js";
import { localCommand } from "../src/ui/control.js";

const summary = {
  sprint: { id: 7, name: "BD Sprint 7", projectKey: "BD", endDate: null, total: 4, byStatus: { todo: 1, inProgress: 2, done: 1 } },
  todaySeconds: 5100,
  recent: [{ key: "BD-6", summary: "Fix login", status: "To Do", category: "todo", updatedAt: "2026-11-03T10:00:00Z" }],
};

/** A fake server process: it can come up, die, or hang. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as string | null, killed: false, kill() {} });
  child.kill = () => {
    child.killed = true;
    child.signalCode = "SIGTERM";
    child.emit("exit", null);
    return true;
  };
  return child;
}

/** Tallyline with a fake fetch that answers once `up` is true, and a fake spawn. */
function setup(opts: { upAtStart?: boolean; comesUp?: boolean; dies?: boolean; built?: boolean } = {}) {
  let up = !!opts.upAtStart;
  const spawned: string[][] = [];
  const child = fakeChild();
  const deps: TallylineDeps = {
    fetch: (async () => {
      if (!up) throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify(summary));
    }) as typeof fetch,
    exists: (p) => (p.endsWith("index.mjs") ? opts.built !== false : true),
    spawn: (cmd, args) => {
      spawned.push([cmd, ...args]);
      if (opts.comesUp) setTimeout(() => (up = true), 20);
      if (opts.dies) setTimeout(() => ((child.exitCode = 1), child.emit("exit", 1)), 20);
      return child as never;
    },
    startMs: 400,
    pollMs: 10,
  };
  return { t: new Tallyline("/w/tallyline", "/tmp/astra-tallyline-test.log", deps), spawned, child };
}

describe("Tallyline lifecycle", () => {
  it("uses a server that's already running, and doesn't own (or stop) it", async () => {
    const { t, spawned } = setup({ upAtStart: true });
    await t.ensureRunning();
    expect(spawned).toEqual([]);
    expect(t.ownsServer).toBe(false);
    expect((await t.summary()).sprint?.name).toBe("BD Sprint 7");
  });

  it("starts it on 127.0.0.1:4317 when it isn't running, and stops it on quit", async () => {
    const { t, spawned, child } = setup({ comesUp: true });
    await t.ensureRunning();
    expect(spawned[0]?.slice(1)).toEqual([".output/server/index.mjs"]);
    expect(t.ownsServer).toBe(true);
    t.stop();
    expect(child.killed).toBe(true);
    expect(t.ownsServer).toBe(false);
  });

  it("says so when it isn't built, dies on start, or never answers (no silent failure, no orphan)", async () => {
    await expect(setup({ built: false }).t.ensureRunning()).rejects.toThrow(/hasn't been built yet/);
    await expect(setup({ dies: true }).t.ensureRunning()).rejects.toThrow(/stopped as it started \(exit 1\)/);
    const hung = setup();
    await expect(hung.t.ensureRunning()).rejects.toThrow(/didn't answer within/);
    expect(hung.child.killed).toBe(true);
  });
});

describe("an older Tallyline already running", () => {
  it("is used, not restarted, and the panel says it needs rebuilding", async () => {
    const spawned: string[] = [];
    const t = new Tallyline("/w/tallyline", "/tmp/x.log", {
      fetch: (async (url: string) => new Response("{}", { status: String(url).endsWith("/api/summary") ? 404 : 200 })) as typeof fetch,
      spawn: () => (spawned.push("spawn"), fakeChild() as never),
    });
    await t.ensureRunning();
    expect(spawned).toEqual([]);
    await expect(t.summary()).rejects.toThrow(/older build without \/api\/summary: rebuild it/);
  });
});

describe("the compact panel's content", () => {
  const module = { exports: {} as { view(m: unknown): any; duration(s: number): string } };
  vm.runInNewContext(readFileSync(new URL("../orb/tallyline-view.js", import.meta.url), "utf8"), { module });
  const { view, duration } = module.exports;

  it("shows the sprint in words, today's time and the latest issues as links into the full app", () => {
    const v = view({ type: "tallyline", summary });
    expect(v.meta).toBe("BD SPRINT 7");
    expect(v.sprint.text).toBe("4 issues: 1 to do, 2 in progress, 1 done");
    expect(v.sprint.board).toBe("/boards/BD");
    expect(v.today).toBe("1 h 25 min");
    expect(v.recent[0]).toEqual({ key: "BD-6", summary: "Fix login", status: "To Do", path: "/issues/BD-6" });
  });

  it("says when it's starting or has failed, and when there's no active sprint", () => {
    expect(view({ starting: true }).state).toBe("starting");
    expect(view({ error: "I couldn't start Tallyline." })).toMatchObject({ state: "error", meta: "NOT RUNNING" });
    expect(view({ summary: { ...summary, sprint: null } }).meta).toBe("NO ACTIVE SPRINT");
    expect(duration(0)).toBe("none yet");
    expect(duration(2400)).toBe("40 min");
  });
});

describe("asking for it", () => {
  it("opens by voice without a round trip to Claude", () => {
    for (const said of ["show Tallyline", "Astra, open my tallyline please", "tallyline"]) expect(localCommand(said)).toEqual({ ui: { action: "show_tallyline" } });
  });
});

describe("the expanded panel is locked to Tallyline", () => {
  const main = readFileSync(new URL("../orb/main.cjs", import.meta.url), "utf8");

  it("only ever shows 127.0.0.1:4317, with no bridge into Astra and its own sandboxed storage", () => {
    expect(main).toMatch(/const TALLYLINE_ORIGIN = "http:\/\/127\.0\.0\.1:4317";/);
    expect(main).toMatch(/new URL\(url\)\.origin === TALLYLINE_ORIGIN/);
    expect(main).toMatch(/TALLYLINE_PREFERENCES = \{ contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "persist:tallyline" \}/);
    const harden = main.slice(main.indexOf("function hardenTallyline"), main.indexOf("function harden(w)"));
    expect(harden).toMatch(/will-navigate/);
    expect(harden).toMatch(/will-redirect/);
    expect(harden).toMatch(/shell\.openExternal/);
    expect(harden).toMatch(/setPermissionRequestHandler\(\(_wc, _perm, done\) => done\(false\)\)/);
  });

  it("only opens it from the compact panel, with a plain path", () => {
    expect(main).toMatch(/m\?\.type === "tallyline-open" && sender && sender === slabs\.tallyline\.win/);
    expect(main).toMatch(/\/\^\\\/\[\\w\\-\.\/\?=&%\]\*\$\/\.test\(m\.path\)/);
  });
});
