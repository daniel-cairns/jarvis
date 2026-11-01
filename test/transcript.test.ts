import { describe, expect, it } from "vitest";
import { clock, parseTranscriptStart, splitStop, transcriptMarkdown, wordCount } from "../src/voice/transcript.js";

describe("parseTranscriptStart", () => {
  it("recognises the ways of starting one, with an optional title", () => {
    expect(parseTranscriptStart("Start a transcript.")).toEqual({});
    expect(parseTranscriptStart("start recording")).toEqual({});
    expect(parseTranscriptStart("take notes about the gymclaw launch")).toEqual({ title: "the gymclaw launch" });
    expect(parseTranscriptStart("start a long transcript called team standup")).toEqual({ title: "team standup" });
    expect(parseTranscriptStart("transcript mode")).toEqual({});
  });

  it("leaves other requests alone", () => {
    expect(parseTranscriptStart("read me the transcript from yesterday")).toBeNull();
    expect(parseTranscriptStart("start the gymclaw session")).toBeNull();
  });
});

describe("splitStop", () => {
  it("keeps what was said before the stop phrase and drops the phrase", () => {
    expect(splitStop("and that's the plan for Tuesday. Astra, stop recording.")).toEqual({ kept: "and that's the plan for Tuesday.", stop: true });
    expect(splitStop("End the transcript")).toEqual({ kept: "", stop: true });
    expect(splitStop("we should stop the build before lunch")).toEqual({ kept: "we should stop the build before lunch", stop: false });
  });
});

describe("transcript formatting", () => {
  it("stamps each line with its time from the start and counts words", () => {
    const start = Date.UTC(2026, 10, 2, 1, 0, 0);
    const lines = [{ at: start + 5_000, text: "Hello there." }, { at: start + 65_000, text: "Second point, three words." }];
    expect(clock(3_725_000)).toBe("1:02:05");
    expect(wordCount(lines)).toBe(6);
    const md = transcriptMarkdown("Standup", start, lines, start + 90_000);
    expect(md).toContain("# Standup");
    expect(md).toContain("01:30 · 6 words");
    expect(md).toContain("**[00:05]** Hello there.");
    expect(md).toContain("**[01:05]** Second point, three words.");
  });
});
