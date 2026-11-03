import { describe, expect, it } from "vitest";
import { isEcho, recentSpeech, ECHO_WINDOW_MS } from "../src/voice/echo.js";
import { matchWakeAnywhere } from "../src/voice/wake.js";
import { isStopCommand } from "../src/ui/control.js";

const said = ["The last teardown was two days ago.", "I'll check what's changed in Temper since then."];

describe("telling her own voice from Dan's", () => {
  it("drops the real echo from 3 Nov, and what whisper made of it", () => {
    // What came in as Dan's message, a moment after she said it.
    expect(isEcho("down was two days ago.", said)).toBe(true);
    // Reproduced with her Kokoro voice and whisper: a recording starting 0.5 s into her sentence.
    const heard = "Astra's teardown was two days ago.";
    const request = matchWakeAnywhere(heard, said[0]!);
    expect(request).toBe("teardown was two days ago.");
    expect(isEcho(request!, said)).toBe(true);
  });

  it("drops fragments of any of her recent sentences", () => {
    expect(isEcho("what's changed in temper since then", said)).toBe(true);
    expect(isEcho("changed in Temper", said)).toBe(true);
  });

  it("lets Dan through, even when he reuses a few of her words", () => {
    expect(isEcho("show me the last teardown of Temper and compare it with linktest", said)).toBe(false);
    expect(isEcho("run the tests", said)).toBe(false);
    expect(isEcho("ok", said)).toBe(false);
    expect(isEcho("down was two days ago", [])).toBe(false);
  });

  it("keeps barge-in: a bare stop always counts, whatever she was saying", () => {
    expect(isStopCommand("stop")).toBe(true);
    expect(isEcho("stop", said)).toBe(false);
    expect(isEcho("stop talking", ["Stop talking about it and look at the panel."])).toBe(true);
  });

  it("only looks back about 20 seconds", () => {
    const now = 100_000;
    const spoken = [
      { text: "Old line from earlier.", at: now - ECHO_WINDOW_MS - 1 },
      { text: "The last teardown was two days ago.", at: now - 2_000 },
    ];
    expect(recentSpeech(spoken, now)).toEqual(["The last teardown was two days ago."]);
  });
});
