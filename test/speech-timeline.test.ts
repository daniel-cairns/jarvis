import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { Speaker } from "../src/voice/speaker.js";
import type { Tts } from "../src/voice/tts.js";

/** A voice that renders instantly, and a player that "plays" each line for 300 ms (silently), logging when. */
function timeline() {
  const t0 = Date.now();
  const events: { what: string; at: number }[] = [];
  const mark = (what: string) => events.push({ what, at: Date.now() - t0 });
  const tts: Tts = {
    name: "fake",
    async warmUp() {},
    async render(text) {
      return { samples: new Float32Array(800).fill(0.1), rate: 8000, text } as never;
    },
  };
  const speaker = new Speaker(tts, null, true, { onUtterance: (u) => mark(`says: ${u.text}`) }, () =>
    spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { stdio: "ignore" }),
  );
  const at = (what: string) => events.find((e) => e.what === what)?.at ?? NaN;
  return { speaker, events, mark, at };
}

describe("speech and panels on one timeline", () => {
  it("opens a panel in its place in what she's saying, not when its tool ran", async () => {
    const { speaker, mark, at } = timeline();
    void speaker.speak("I'll pull up the comparison.");
    // The tool runs straight away, while the first sentence is still playing.
    speaker.cue(() => mark("panel"));
    void speaker.speak("Temper is ahead on tests.");
    await speaker.whenIdle();
    // Before: the panel opened at once, under the first sentence. Now: after it, as the next one starts.
    expect(at("panel")).toBeGreaterThanOrEqual(at("says: I'll pull up the comparison.") + 250);
    expect(at("panel")).toBeLessThanOrEqual(at("says: Temper is ahead on tests."));
  });

  it("with say, the panel opens as its sentence starts (well within half a second)", async () => {
    const { speaker, mark, at } = timeline();
    void speaker.speak("Looking it up.");
    void speaker.speak("Here's the comparison.", { onStart: () => mark("panel") });
    await speaker.whenIdle();
    const gap = Math.abs(at("panel") - at("says: Here's the comparison."));
    expect(gap).toBeLessThan(500);
    expect(at("panel")).toBeGreaterThan(at("says: Looking it up.") + 250);
  });

  it("still opens the panel straight away when nothing is being said, or when she's stopped", async () => {
    const quiet = timeline();
    let shown = false;
    quiet.speaker.cue(() => (shown = true));
    expect(shown).toBe(true);

    const stopped = timeline();
    let opened = false;
    void stopped.speaker.speak("A long explanation she won't finish.");
    void stopped.speaker.speak("About this.", { onStart: () => (opened = true) });
    stopped.speaker.stop();
    await stopped.speaker.whenIdle();
    expect(opened).toBe(true);
  });

  it("opens it at once when speech is off (type-only), with nothing to wait for", async () => {
    let opened = false;
    const off = new Speaker({ name: "x", async warmUp() {}, async render() { return { samples: new Float32Array(1), rate: 8000 }; } }, null, false);
    await off.speak("Here it is.", { onStart: () => (opened = true) });
    expect(opened).toBe(true);
  });
});
