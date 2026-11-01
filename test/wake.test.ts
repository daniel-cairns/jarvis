import { describe, expect, it } from "vitest";
import { matchWake, matchWakeAnywhere, speechHint, stripOwnSpeech } from "../src/voice/wake.js";

describe("stripOwnSpeech", () => {
  it("cuts her own reply off a request heard over her voice", () => {
    expect(
      stripOwnSpeech("run the shell command date for me. It's now 1.13 in the morning on Monday", [
        "It's now 1:13 in the morning on Monday, the second of November.",
      ]),
    ).toBe("run the shell command date for me.");
  });

  it("leaves a request alone when none of her sentences appear in it", () => {
    expect(stripOwnSpeech("open Quire", ["The teardown is saved."])).toBe("open Quire");
    expect(stripOwnSpeech("stop", [])).toBe("stop");
  });
});

describe("matchWakeAnywhere", () => {
  it("finds the name mid-recording while she talks", () => {
    expect(matchWakeAnywhere("and the teardown found three modules Astra stop", "And the teardown found three modules.")).toBe("stop");
    expect(matchWakeAnywhere("so the app uses CloudKit. Astra, open Quire.", "So the app uses CloudKit.")).toBe("open Quire.");
  });

  it("ignores her own voice saying her name, and recordings without it", () => {
    expect(matchWakeAnywhere("Hi, Astra here.", "Hi Dan. Astra here.")).toBeNull();
    expect(matchWakeAnywhere("the app uses CloudKit", "The app uses CloudKit.")).toBeNull();
  });
});

describe("matchWake", () => {
  it("wakes on Astra at the start, returning the rest as the request", () => {
    expect(matchWake("Astra, open Quire for me.")).toBe("open Quire for me.");
    expect(matchWake(" Hey Astra. What's in my brain?")).toBe("What's in my brain?");
    expect(matchWake("Astrid, stop.")).toBe("stop.");
    expect(matchWake("Astra.")).toBe("");
    expect(matchWake("astra yes")).toBe("yes");
  });

  it("ignores the name in passing and similar words", () => {
    expect(matchWake("I was telling Sam about Astra")).toBeNull();
    expect(matchWake("Astronomy is great")).toBeNull();
    expect(matchWake("Extra cheese please")).toBeNull();
    expect(matchWake("")).toBeNull();
  });
});

describe("speechHint", () => {
  it("names projects in a sentence, which is the shape whisper accepts", () => {
    expect(speechHint([])).toBe("Talking to Astra about REA teardowns and Nuxt apps.");
    expect(speechHint(["quire"])).toBe("Talking to Astra about REA teardowns and Nuxt apps, and the projects quire.");
    expect(speechHint(["quire", "lumen", "tally"])).toMatch(/projects quire, lumen and tally\.$/);
  });

  it("skips folder names that aren't plain words", () => {
    expect(speechHint([".git", "node_modules/x", "quire"])).toMatch(/projects quire\.$/);
  });
});
