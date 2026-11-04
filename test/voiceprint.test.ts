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
