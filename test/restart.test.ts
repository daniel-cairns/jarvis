import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESTART_CHECK_MS, RESTART_REPORT_MS, restartBlocker, stillBlockedMessage, waitingMessage } from "../src/ui/restart.js";

describe("when Astra can restart", () => {
  it("restarts straight away when she's free and no run is going", () => {
    expect(restartBlocker({ busy: false, running: [] })).toBeNull();
  });

  it("waits for a reply in progress, and says so", () => {
    expect(restartBlocker({ busy: true, running: [] })).toBe("I'm still in the middle of a reply");
    expect(waitingMessage({ busy: true, running: [] })).toBe("I'll restart as soon as this reply ends.");
  });

  it("waits for background runs, naming them", () => {
    const state = { busy: false, running: ["s2 (hierogitics)", "s4 (jarvis)"] };
    expect(restartBlocker(state)).toBe("s2 (hierogitics) and s4 (jarvis) are still running");
    expect(waitingMessage(state)).toBe("I'll restart once s2 (hierogitics) and s4 (jarvis) have finished.");
    expect(waitingMessage({ busy: true, running: ["s1 (tallyline)"] })).toBe("I'll restart once s1 (tallyline) has finished.");
  });

  it("reports a restart that's still blocked after a while, instead of staying silent", () => {
    expect(RESTART_CHECK_MS).toBeLessThan(RESTART_REPORT_MS);
    expect(stillBlockedMessage({ busy: false, running: ["s2 (hierogitics)"] })).toBe(
      "I still haven't restarted: s2 (hierogitics) is still running. I'll keep waiting; to restart straight away, quit me and reopen Astra.",
    );
  });
});

describe("the restart and quit wiring", () => {
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

  it("leaves the main loop on the quitting flag, so a /quit swallowed while listening can't strand her", () => {
    const loop = src.slice(src.indexOf('const input = await getInput(voiceMode ? "\\n[Enter to talk] > "'));
    expect(loop.slice(0, 600)).toMatch(/if \(quitting\) break;/);
  });

  it("makes Quit cancel a waiting restart and clear the restart flag, so Quit really quits", () => {
    const quit = src.slice(src.indexOf("onQuit: () => {"), src.indexOf("onBrain:"));
    expect(quit).toMatch(/cancelPendingRestart\(\)/);
    expect(quit).toMatch(/rmSync\(path\.join\(cfg\.home, "restart"\)/);
  });

  it("re-checks a waiting restart on a timer, not only when a reply or run ends", () => {
    expect(src).toMatch(/setInterval\(restartIfDue, RESTART_CHECK_MS\)/);
  });
});
