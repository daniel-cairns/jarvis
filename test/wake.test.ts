import { describe, expect, it } from "vitest";
import { matchWake, speechHint } from "../src/voice/wake.js";

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
