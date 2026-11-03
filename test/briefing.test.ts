import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { answeredNote, Briefing, runFinishedNote } from "../src/briefing.js";
import { Speaker } from "../src/voice/speaker.js";
import { isMetaReply } from "../src/voice/speechText.js";
import type { Tts } from "../src/voice/tts.js";

/** A speaker whose voice renders instantly and whose player "plays" each line for 300 ms, logging what it said. */
function speakerWithLog() {
  const said: string[] = [];
  const tts: Tts = {
    name: "fake",
    async warmUp() {},
    async render(text) {
      return { samples: new Float32Array(800).fill(0.1), rate: 8000, text } as never;
    },
  };
  const speaker = new Speaker(tts, null, true, { onUtterance: (u) => said.push(u.text) }, () =>
    spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"], { stdio: "ignore" }),
  );
  return { speaker, said };
}

describe("an answered card stops talking", () => {
  it("drops a card's question that's still queued once the card is answered", async () => {
    const { speaker, said } = speakerWithLog();
    const card = new AbortController();
    void speaker.speak("I've checked the build.");
    void speaker.speak("Add Start epic to Quench? Yes, or not yet?", { signal: card.signal });
    void speaker.speak("Moving on.");
    card.abort();
    await speaker.whenIdle();
    expect(said).toEqual(["I've checked the build.", "Moving on."]);
  });

  it("cuts the question off mid-sentence, and only that one", async () => {
    const { speaker, said } = speakerWithLog();
    const card = new AbortController();
    const t0 = Date.now();
    void speaker.speak("Which stack? TypeScript. Python. Or plain JavaScript.", { signal: card.signal });
    void speaker.speak("Got it.");
    setTimeout(() => card.abort(), 100);
    await speaker.whenIdle();
    expect(said).toEqual(["Which stack?", "Got it."]);
    expect(Date.now() - t0).toBeLessThan(900);
  });
});

describe("meta replies aren't spoken", () => {
  it.each(["No response requested.", "no response needed", "(No response requested.)", "Nothing to add.", "*No reply needed.*"])(
    "drops %j",
    (text) => expect(isMetaReply(text)).toBe(true),
  );
  it.each(["No response requested from Temper yet, so I'll wait.", "Nothing to add to the plan, it's ready.", "Done."])(
    "keeps %j",
    (text) => expect(isMetaReply(text)).toBe(false),
  );
});

describe("Briefing", () => {
  it("hands notes over once, and only a finish makes one due", () => {
    const b = new Briefing();
    b.add(answeredNote("Quench", "Add Start epic?", "Yes, after Q2"));
    expect(b.due).toBe(false);
    b.add("The Quench background session (s1) finished.", true);
    expect(b.due).toBe(true);
    const context = b.take();
    expect(context).toContain('"Add Start epic?" with: Yes, after Q2');
    expect(context).toContain("(s1) finished");
    expect(b.due).toBe(false);
    expect(b.take()).toBe("");
  });

  it("describes a finished run with its report and the questions that never reached Dan", () => {
    const note = runFinishedNote({ id: "s2", label: "Temper", status: "done", lastText: "All 117 tests pass. Want me to push?", unanswered: ["Push now?"] });
    expect(note).toBe('The Temper background session (s2) finished. Its final message: """All 117 tests pass. Want me to push?""" Questions it had that never reached Dan: Push now?');
    const failed = runFinishedNote({ id: "s3", label: "Gym", status: "failed", lastText: "x".repeat(3000), unanswered: [] });
    expect(failed).toMatch(/^The Gym background session \(s3\) ran into a problem\./);
    expect(failed.length).toBeLessThan(2100);
  });
});
