import { describe, expect, it } from "vitest";
import { matchChoices, parseVoiceApproval, speakQuestion } from "../src/voice/answers.js";

describe("parseVoiceApproval", () => {
  it("understands natural yes, always and no", () => {
    expect(parseVoiceApproval("Yeah, go ahead.")).toBe("yes");
    expect(parseVoiceApproval("Sure")).toBe("yes");
    expect(parseVoiceApproval("Always, don't ask me again")).toBe("always");
    expect(parseVoiceApproval("No thanks.")).toBe("no");
    expect(parseVoiceApproval("Not now")).toBe("no");
  });

  it("returns null when the answer isn't clear, so she can ask again", () => {
    expect(parseVoiceApproval("hmm what is that for")).toBeNull();
    expect(parseVoiceApproval("")).toBeNull();
  });
});

const services = [{ label: "Spotify" }, { label: "Apple Music" }, { label: "SoundCloud" }];

describe("matchChoices", () => {
  it("matches by position or by name", () => {
    expect(matchChoices("The second one.", services)).toEqual(["Apple Music"]);
    expect(matchChoices("number three", services)).toEqual(["SoundCloud"]);
    expect(matchChoices("the last one", services)).toEqual(["SoundCloud"]);
    expect(matchChoices("Let's go with Spotify.", services)).toEqual(["Spotify"]);
    expect(matchChoices("apple music please", services)).toEqual(["Apple Music"]);
  });

  it("picks several for multi-select", () => {
    expect(matchChoices("Spotify and SoundCloud", services, true)).toEqual(["Spotify", "SoundCloud"]);
    expect(matchChoices("all of them", services, true)).toEqual(["Spotify", "Apple Music", "SoundCloud"]);
  });

  it("returns null when nothing matches", () => {
    expect(matchChoices("I'm not sure yet", services)).toBeNull();
    expect(matchChoices("that one", services)).toBeNull();
  });
});

describe("speakQuestion", () => {
  it("reads short option lists aloud and defers long ones to the screen", () => {
    expect(speakQuestion("Which service?", services)).toBe("Which service? Spotify, Apple Music, or SoundCloud?");
    expect(speakQuestion("Pick one.", Array.from({ length: 6 }, (_, i) => ({ label: `O${i}` })))).toBe(
      "Pick one. The options are on screen.",
    );
    expect(speakQuestion("What should I call it?", [])).toBe("What should I call it?");
  });
});

describe("answering tonight's cards by voice", () => {
  const send = [{ label: "Send both to Jarvis" }, { label: "Not now" }];
  const wait = [{ label: "Wait for Jarvis" }, { label: "Go ahead anyway" }, { label: "Control Chrome in the background" }];

  it("matches the full label, even with short words like 'to' in it", () => {
    expect(matchChoices("Send both to Jarvis.", send)).toEqual(["Send both to Jarvis"]);
    expect(matchChoices("send both to jarvis please", send)).toEqual(["Send both to Jarvis"]);
  });

  it("matches a clear part of a label", () => {
    expect(matchChoices("send both", send)).toEqual(["Send both to Jarvis"]);
    expect(matchChoices("not now", send)).toEqual(["Not now"]);
    expect(matchChoices("wait", wait)).toEqual(["Wait for Jarvis"]);
    expect(matchChoices("go ahead", wait)).toEqual(["Go ahead anyway"]);
    expect(matchChoices("control chrome in the background", wait)).toEqual(["Control Chrome in the background"]);
  });

  it("matches by position", () => {
    expect(matchChoices("the first one", send)).toEqual(["Send both to Jarvis"]);
    expect(matchChoices("option two", wait)).toEqual(["Go ahead anyway"]);
    expect(matchChoices("the last one", wait)).toEqual(["Control Chrome in the background"]);
  });

  it("doesn't guess when a word fits two options equally", () => {
    expect(matchChoices("jarvis", [{ label: "Ask Jarvis" }, { label: "Tell Jarvis" }])).toBeNull();
    expect(matchChoices("something else entirely", send)).toBeNull();
  });
});
