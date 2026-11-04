import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cosine, meanPrint, normalise, thresholdFor, VoiceCheck, type Embedder } from "../src/voice/voiceprint.js";
import { localCommand } from "../src/ui/control.js";

/** A stand-in speaker model: a clip's "voice" is its first sample, so tests choose who's speaking. */
const voices: Record<number, number[]> = { 1: [1, 0.1, 0], 2: [0.9, 0.2, 0.1], 3: [0, 1, 0.2] };
const fake: Embedder = async (samples) => normalise(voices[samples[0]!]!);
const clip = (who: number, seconds: number) => new Float32Array(Math.round(seconds * 16_000)).fill(who);

describe("thresholdFor", () => {
  it("raises the bar with phrase length, between the measured points", () => {
    expect(thresholdFor(0.5)).toBe(0.8);
    expect(thresholdFor(1.25)).toBeCloseTo(0.856);
    expect(thresholdFor(2.5)).toBeCloseTo(0.8975);
    expect(thresholdFor(10)).toBe(0.944);
    expect(thresholdFor(2, -0.05)).toBeCloseTo(0.82);
  });
});

describe("VoiceCheck", () => {
  it("listens to everyone until Dan enrols", async () => {
    const check = new VoiceCheck(mkdtempSync(path.join(os.tmpdir(), "astra-voice-")), fake);
    expect(check.enrolled).toBe(false);
    expect(await check.verdict(clip(3, 2))).toBeNull();
  });

  it("accepts Dan's voice and refuses another, once enrolled", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "astra-voice-"));
    const check = new VoiceCheck(home, fake);
    const { selfScores } = await check.enrol([clip(1, 4), clip(2, 4), clip(1, 4)]);
    expect(selfScores).toHaveLength(3);
    expect((await check.verdict(clip(1, 2)))?.ok).toBe(true);
    const stranger = await check.verdict(clip(3, 2));
    expect(stranger?.ok).toBe(false);
    expect(stranger?.score).toBeLessThan(stranger!.threshold);
    // Too short to judge: nothing is decided.
    expect(await check.verdict(clip(3, 0.2))).toBeNull();
    // Saved for next time, and forgotten on request.
    expect(new VoiceCheck(home, fake).enrolled).toBe(true);
    expect(JSON.parse(readFileSync(path.join(home, "voiceprint.json"), "utf8")).embedding).toHaveLength(3);
    check.forget();
    expect(new VoiceCheck(home, fake).enrolled).toBe(false);
  });

  it("won't enrol from fewer than three phrases", async () => {
    const check = new VoiceCheck(mkdtempSync(path.join(os.tmpdir(), "astra-voice-")), fake);
    await expect(check.enrol([clip(1, 4)])).rejects.toThrow(/three/);
  });

  it("averages embeddings into a normalised print", () => {
    const print = meanPrint([normalise([1, 0]), normalise([0, 1])]);
    expect(cosine(print, print)).toBeCloseTo(1);
    expect(print[0]).toBeCloseTo(Math.SQRT1_2);
  });
});

describe("voice commands", () => {
  it.each(["Learn my voice", "Astra, only listen to me", "enrol my voice please"])("hears %j as /voiceprint", (s) => {
    expect(localCommand(s)).toEqual({ slash: "/voiceprint" });
  });
  it.each(["Forget my voice", "listen to everyone again"])("hears %j as /voiceprint off", (s) => {
    expect(localCommand(s)).toEqual({ slash: "/voiceprint off" });
  });
});

describe("fitting the bar to Dan's microphone", () => {
  it("sets the bar a gap under his enrolment, because everyday speech scores lower than reading aloud", async () => {
    const { calibratedAdjust, thresholdFor } = await import("../src/voice/voiceprint.js");
    // His real enrolment on 4 Nov (readings 0.97-0.99) and the everyday phrases refused against it.
    const adjust = calibratedAdjust([0.978, 0.991, 0.972, 0.979, 0.982]);
    expect(thresholdFor(4, adjust)).toBeCloseTo(0.892, 3);
    for (const [score, seconds] of [[0.921, 5.6], [0.906, 5.2], [0.942, 4.6], [0.938, 3.8]] as const) {
      expect(score).toBeGreaterThanOrEqual(thresholdFor(seconds, adjust));
    }
    // A phrase far from his voice is still refused.
    expect(0.695).toBeLessThan(thresholdFor(4.9, adjust));
  });

  it("never raises the bar, and never lowers it so far that most voices get through", async () => {
    const { calibratedAdjust } = await import("../src/voice/voiceprint.js");
    expect(calibratedAdjust([1, 1, 1])).toBeLessThanOrEqual(0);
    expect(calibratedAdjust([0.5, 0.6, 0.55])).toBe(-0.12);
  });
});

describe("the enrolment panel", () => {
  it("shows every sentence, the one to read now large and marked, and ticks the ones done", async () => {
    const { enrolPanel, ENROL_SENTENCES } = await import("../src/voice/voiceprint.js");
    const md = enrolPanel(1, new Set([0]));
    expect(md).toContain(`Read number 2 of 5\n\n> **${ENROL_SENTENCES[1]}**`);
    expect(md).toContain(`1. ✓ ${ENROL_SENTENCES[0]}`);
    expect(md).toContain(`2. ▶ ${ENROL_SENTENCES[1]}`);
    for (const sentence of ENROL_SENTENCES) expect(md).toContain(sentence);
    expect(enrolPanel(3, new Set([0, 1, 2]), true)).toContain("Once more: read number 4");
  });
});

describe("VoiceCheck.enrol calibrates", () => {
  it("saves the adjust it chose, and readingScores matches what enrol reports", async () => {
    const { mkdtempSync } = await import("node:fs");
    const os = await import("node:os");
    const home = mkdtempSync(path.join(os.tmpdir(), "vp-"));
    // Fake embeddings: the clip's first sample picks a direction, so readings can be made to disagree.
    const embed: Embedder = async (s) => normalise([1, s[0]!, 0.1]);
    const clips = [0.1, 0.12, 0.11, 0.9].map((v) => Float32Array.from({ length: 16_000 }, () => v));
    const check = new VoiceCheck(home, embed);
    const scores = await check.readingScores(clips);
    expect(scores[3]).toBeLessThan(scores[0]!);
    const { selfScores, adjust } = await check.enrol(clips);
    expect(selfScores).toEqual(scores);
    expect(JSON.parse(readFileSync(path.join(home, "voiceprint.json"), "utf8")).adjust).toBe(adjust);
  });
});
