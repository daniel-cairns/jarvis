import { existsSync, readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { decodeWav16 } from "../src/voice/audio.js";
import { chooseEndDetector, Listener } from "../src/voice/listener.js";
import { FRAME_MS, FRAME_SAMPLES, loadVadModel, SileroVad, SpeechEnd, VadCapture } from "../src/voice/vad.js";

const RATE = 16_000;
const MODEL = path.join(os.homedir(), ".jarvis", "models", "silero_vad.onnx");
const speech = (name: string) => decodeWav16(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).samples;

/** Steady broadband noise (like a fan or room hum) at a given RMS, deterministic. */
function noise(seconds: number, rms: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let seed = 11;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * Math.sqrt(3) * rms;
  }
  return out;
}

/** Lays clips end to end over a bed of steady noise, as a 16-bit PCM buffer. */
function mix(clips: Float32Array[], noiseRms: number): Buffer {
  const total = clips.reduce((n, c) => n + c.length, 0);
  const bed = noise(total / RATE, noiseRms);
  let at = 0;
  for (const c of clips) {
    for (let i = 0; i < c.length; i++) bed[at + i] = Math.max(-1, Math.min(1, bed[at + i]! + c[i]!));
    at += c.length;
  }
  return Buffer.from(Int16Array.from(bed, (s) => Math.round(s * 32_767)).buffer);
}

const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const rms = (s: Float32Array) => Math.sqrt(s.reduce((n, x) => n + x * x, 0) / s.length);

describe("SpeechEnd (the end-of-speech rule)", () => {
  const frames = (ms: number) => Math.round(ms / FRAME_MS);
  const feed = (d: SpeechEnd, p: number, ms: number) => {
    let last = "";
    for (let i = 0; i < frames(ms); i++) last = d.push(p);
    return last;
  };

  it("waits for speech, then ends about 1.5 s after it stops", () => {
    const d = new SpeechEnd({ endSilenceMs: 1500 });
    expect(feed(d, 0.1, 3000)).toBe("waiting"); // room noise alone never starts it
    expect(feed(d, 0.9, 2000)).toBe("speech");
    expect(feed(d, 0.1, 1400)).toBe("speech");
    expect(feed(d, 0.1, 200)).toBe("ended");
  });

  it("doesn't cut you off at a mid-sentence pause, or a soft syllable", () => {
    const d = new SpeechEnd({ endSilenceMs: 1500 });
    feed(d, 0.9, 1000);
    expect(feed(d, 0.1, 1000)).toBe("speech"); // a one-second pause
    feed(d, 0.9, 500);
    expect(feed(d, 0.4, 2000)).toBe("speech"); // between the thresholds: not silence
    expect(feed(d, 0.05, 1600)).toBe("ended");
  });

  it("ignores a lone click before you start", () => {
    const d = new SpeechEnd();
    d.push(0.95);
    expect(d.push(0.1)).toBe("waiting");
    expect(d.started).toBe(false);
  });
});

describe.skipIf(!existsSync(MODEL))("the Silero speech detector on recorded speech with steady noise", () => {
  /** Runs a mix through the detector the way a live recording is, in 4 KB chunks; returns when it said "finished". */
  async function endTime(pcm: Buffer): Promise<{ endedAt: number | null; kept: number }> {
    const vad = new SileroVad(await loadVadModel(MODEL));
    let frame = 0;
    let endedAt: number | null = null;
    const capture = new VadCapture(vad, () => (endedAt ??= (frame * FRAME_SAMPLES) / RATE), { endSilenceMs: 1500 });
    for (let i = 0; i < pcm.length; i += 4096) {
      capture.write(pcm.subarray(i, i + 4096));
      await capture.settle();
      frame = Math.floor(Math.min(i + 4096, pcm.length) / 2 / FRAME_SAMPLES);
    }
    return { endedAt, kept: capture.result().pcm.length / RATE };
  }

  it("ends about 1.5 s after the speech stops, with steady noise well above the old 1% level", async () => {
    const a = speech("speech-a.wav");
    const loud = 0.05; // 5% RMS: five times the old fixed threshold
    expect(rms(noise(1, loud))).toBeGreaterThan(0.01 * 4);
    const lead = 1;
    const { endedAt, kept } = await endTime(mix([silence(lead), a, silence(4)], loud));
    const speechEnd = lead + a.length / RATE;
    expect(endedAt).not.toBeNull();
    expect(endedAt! - speechEnd).toBeGreaterThan(1.2);
    expect(endedAt! - speechEnd).toBeLessThan(2.2);
    // It kept the speech (plus a short lead-in), not the whole noisy recording.
    expect(kept).toBeGreaterThan(a.length / RATE);
    expect(kept).toBeLessThan(a.length / RATE + 2.8);
  });

  it("doesn't end at a pause mid-sentence", async () => {
    const a = speech("speech-a.wav");
    const b = speech("speech-b.wav");
    const lead = 0.5;
    const pause = 0.9;
    const { endedAt } = await endTime(mix([silence(lead), a, silence(pause), b, silence(3)], 0.03));
    const secondStart = lead + a.length / RATE + pause;
    expect(endedAt).not.toBeNull();
    expect(endedAt!).toBeGreaterThan(secondStart + b.length / RATE);
  });

  it("never starts on steady noise alone", async () => {
    const { endedAt, kept } = await endTime(mix([silence(5)], 0.05));
    expect(endedAt).toBeNull();
    expect(kept).toBe(0);
  });
});

describe("the recorder around it", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "astra-vad-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  /** A stand-in for sox's rec that records its arguments, then streams silence (or zeros) until stopped. */
  const fakeRec = (name: string) => {
    const bin = path.join(tmp, name);
    writeFileSync(bin, `#!/bin/sh\necho "$@" > "${bin}.args"\nexec cat /dev/zero\n`);
    chmodSync(bin, 0o755);
    return bin;
  };
  const cfg = (recorderBin: string, vadModel?: string) => ({ recorderBin, whisperBin: "true", whisperModel: "/dev/null", vadModel, maxListenMs: 45_000 });

  it("falls back to the loudness threshold, and says why, when the detector can't load", async () => {
    const choice = await chooseEndDetector(path.join(tmp, "missing.onnx"));
    expect(choice).toEqual({ kind: "loudness", reason: expect.stringContaining("no speech detector model") });
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const l = new Listener(cfg(fakeRec("rec-loud"), path.join(tmp, "missing.onnx")));
    await l.start({ autoStop: true, quietPercent: 2, maxMs: 300 });
    expect(l.recording).toBe(true); // it still records, on the loudness path
    await l.whenDone();
    await l.cancel();
    expect(logged.mock.calls.flat().join("\n")).toMatch(/Speech detector unavailable \(no speech detector model at .*\): ending recordings on the room-calibrated loudness threshold instead/);
    logged.mockRestore();
  });

  it.skipIf(!existsSync(MODEL))("never records past the length cap, even with no speech and no give-up time", async () => {
    const bin = fakeRec("rec-vad");
    const l = new Listener(cfg(bin, MODEL));
    const t0 = Date.now();
    await l.start({ autoStop: true, noSpeechMs: Infinity, maxMs: 700 });
    await l.whenDone();
    const took = Date.now() - t0;
    await l.cancel();
    expect(readFileSync(`${bin}.args`, "utf8").trim()).toMatch(/-t raw -$/); // the speech-detector path: raw audio to Node
    expect(took).toBeGreaterThanOrEqual(650);
    // Generous: other test files run the detector in parallel and can slow this down. Without the cap it would
    // never end at all (no speech and no give-up time).
    expect(took).toBeLessThan(6000);
  }, 15_000);
});
