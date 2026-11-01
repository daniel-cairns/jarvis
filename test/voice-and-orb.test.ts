import { spawn } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { renderDetail } from "../src/ui/detail.js";
import { parseFromOrb } from "../src/ui/orb.js";
import { minSpeechBytes, recorderArgs } from "../src/voice/listener.js";
import { decodeWav16, encodeWav16, loudnessEnvelope } from "../src/voice/audio.js";
import { Speaker, type Utterance } from "../src/voice/speaker.js";
import type { Tts } from "../src/voice/tts.js";

const tone = (seconds: number, rate = 8000, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / rate));

describe("WAV encode/decode", () => {
  it("round-trips 16-bit mono PCM", () => {
    const samples = tone(0.1);
    const back = decodeWav16(encodeWav16({ samples, rate: 8000 }));
    expect(back.rate).toBe(8000);
    expect(back.samples.length).toBe(samples.length);
    expect(Math.abs(back.samples[20]! - samples[20]!)).toBeLessThan(1e-3);
  });

  it("rejects files that aren't WAV", () => {
    expect(() => decodeWav16(Buffer.from("not audio at all, definitely"))).toThrow("Not a WAV");
  });
});

describe("loudnessEnvelope", () => {
  it("is loud where the sound is and quiet where it isn't", () => {
    const rate = 6000;
    const samples = new Float32Array(rate); // 1 s: silence, then tone in the second half
    samples.set(tone(0.5, rate), rate / 2);
    const env = loudnessEnvelope({ samples, rate }, 100);
    expect(env).toHaveLength(10);
    expect(env[0]).toBe(0);
    expect(Math.max(...env)).toBe(1);
    expect(env[9]).toBeGreaterThan(0.9);
  });

  it("doesn't blow a near-silent clip up into a full pulse", () => {
    const env = loudnessEnvelope({ samples: tone(0.2, 8000, 0.005), rate: 8000 }, 50);
    expect(Math.max(...env)).toBeLessThan(0.2);
  });
});

/** A player that "plays" by running a short-lived node process, so tests stay silent. */
const silentPlayer = (log: string[]) => (wav: string) => {
  log.push(wav);
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 20)"], { stdio: "ignore" });
};

const fakeTts = (name: string, fail = false): Tts & { rendered: string[] } => ({
  name,
  rendered: [],
  async warmUp() {
    if (fail) throw new Error(`${name} missing`);
  },
  async render(text) {
    if (fail) throw new Error(`${name} missing`);
    this.rendered.push(text);
    return { samples: tone(0.05), rate: 8000 };
  },
});

describe("Speaker", () => {
  it("speaks sentence by sentence and reports each one with its envelope", async () => {
    const tts = fakeTts("primary");
    const played: string[] = [];
    const utterances: Utterance[] = [];
    const states: boolean[] = [];
    const speaker = new Speaker(tts, null, true, {
      onUtterance: (u) => utterances.push(u),
      onSpeaking: (on) => states.push(on),
    }, silentPlayer(played));
    await speaker.speak("**Done.** I saved it to your brain.");
    expect(tts.rendered).toEqual(["Done.", "I saved it to your brain."]);
    expect(played).toHaveLength(2);
    expect(utterances.map((u) => u.text)).toEqual(["Done.", "I saved it to your brain."]);
    expect(utterances[0]!.envelope.length).toBeGreaterThan(0);
    expect(states).toEqual([true, false]);
  });

  it("falls back to the second engine when the first can't load", async () => {
    const fallback = fakeTts("say");
    const switched: string[] = [];
    const speaker = new Speaker(fakeTts("kokoro", true), fallback, true, {
      onFallback: (from, to) => switched.push(`${from}->${to}`),
    }, silentPlayer([]));
    await speaker.warmUp();
    await speaker.speak("Hello.");
    expect(switched).toEqual(["kokoro->say"]);
    expect(fallback.rendered).toEqual(["Hello."]);
  });

  it("queues lines so they never overlap, in order", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const speaker = new Speaker(fakeTts("primary"), null, true, {
      onUtterance: (u) => order.push(u.text),
    }, () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60)"], { stdio: "ignore" });
      child.on("exit", () => active--);
      return child;
    });
    await Promise.all([speaker.speak("First line."), speaker.speak("Second line."), speaker.speak("Third.")]);
    expect(order).toEqual(["First line.", "Second line.", "Third."]);
    expect(maxActive).toBe(1);
  });

  it("stop() drops everything queued", async () => {
    const tts = fakeTts("primary");
    const speaker = new Speaker(tts, null, true, {}, silentPlayer([]));
    const first = speaker.speak("One.");
    const second = speaker.speak("Two.");
    speaker.stop();
    await Promise.all([first, second]);
    expect(tts.rendered.length).toBeLessThanOrEqual(1);
    expect(speaker.busy).toBe(false);
  });

  it("plays at the set volume", async () => {
    const peaks: number[] = [];
    const speaker = new Speaker(fakeTts("primary"), null, true, {}, (wav) => {
      const { samples } = decodeWav16(fs.readFileSync(wav));
      peaks.push(Math.max(...samples.map(Math.abs)));
      return spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    });
    await speaker.speak("Full.");
    speaker.volume = 0.25;
    await speaker.speak("Quiet.");
    expect(peaks[1]! / peaks[0]!).toBeCloseTo(0.25, 1);
  });

  it("stays silent when disabled", async () => {
    const tts = fakeTts("primary");
    await new Speaker(tts, null, false, {}, silentPlayer([])).speak("Hello.");
    expect(tts.rendered).toEqual([]);
  });
});

describe("parseFromOrb", () => {
  it("accepts only well-formed orb messages", () => {
    expect(parseFromOrb('{"type":"talk"}')).toEqual({ type: "talk" });
    expect(parseFromOrb('{"type":"stop"}')).toEqual({ type: "stop" });
    expect(parseFromOrb('{"type":"answer","id":"3","answer":"always"}')).toEqual({ type: "answer", id: "3", answer: "always" });
    expect(parseFromOrb('{"type":"answer","id":"3","answer":"sure"}')).toBeNull();
    expect(parseFromOrb('{"type":"exec","cmd":"rm"}')).toBeNull();
    expect(parseFromOrb("[1234:ERROR:gpu_init.cc] Chromium noise")).toBeNull();
  });
});

describe("recorderArgs", () => {
  it("records 16 kHz mono 16-bit, and only adds silence detection for auto-stop", () => {
    expect(recorderArgs("/tmp/a.wav")).toEqual(["-q", "-r", "16000", "-c", "1", "-b", "16", "/tmp/a.wav"]);
    // "2.00", never "2": sox reads a bare integer as samples and stopped every recording at the first word gap.
    expect(recorderArgs("/tmp/a.wav", { autoStop: true, pauseSec: 2 }).slice(8)).toEqual(
      ["silence", "1", "0.10", "1%", "1", "2.00", "1%"],
    );
  });

  it("boosts a quiet mic before speech detection, with a limiter", () => {
    expect(recorderArgs("/tmp/a.wav", { autoStop: true, gainDb: 20 }).slice(8, 12)).toEqual(["gain", "-l", "20", "silence"]);
  });
});

describe("renderDetail", () => {
  it("renders markdown structure for the panel", () => {
    const html = renderDetail("## Stack\n\n| Part | Tech |\n|---|---|\n| UI | Vue |\n\n- one\n- **two**\n\n```ts\nconst a = 1;\n```");
    expect(html).toContain("<h2>Stack</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>two</strong>");
    expect(html).toContain('<code class="language-ts">');
  });

  it("can't be used to inject markup or script", () => {
    const html = renderDetail('<img src=x onerror="alert(1)"> <script>alert(2)</script>\n\n[bad](javascript:alert(3)) [ok](https://example.com "t") ![logo](https://e.com/x.png)');
    expect(html).not.toMatch(/<img|<script|href="javascript/i);
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="https://example.com" title="t">ok</a>');
    expect(html).toContain("[image: logo]");
  });
});

describe("minSpeechBytes", () => {
  it("keeps a quick spoken 'no' (about 0.4 s once trimmed) but still drops push-to-talk taps", () => {
    const noTrimmed = 13_162; // measured: "No." after sox's silence trimming
    expect(noTrimmed).toBeGreaterThan(minSpeechBytes(true));
    expect(minSpeechBytes(false)).toBe(16_000);
  });
});
