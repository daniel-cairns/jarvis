import os from "node:os";
import path from "node:path";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

export type JarvisConfig = {
  home: string;
  brainDir: string;
  workspaceDir: string;
  model: string;
  effort: EffortLevel;
  tts: TtsEngine;
  voice: string;
  sayVoice: string;
  speechRate: number;
  ttsCacheDir: string;
  wakeWord: boolean;
  /** Seconds of quiet that mean "finished talking". */
  pauseSec: number;
  /**
   * Microphone boost in dB (with a limiter) before speech detection. 18 dB by default: at this Mac's mic input level
   * (19/100) a quietly spoken "no" was never heard without it, while room noise stays below the threshold with it.
   */
  micGainDb: number;
  /** Longest a single recording may run (ms), so steady background noise can't keep her listening forever. */
  maxListenMs: number;
  /** Silero speech detector model (ONNX); recordings fall back to the loudness threshold if it's missing. */
  vadModel: string;
  recorderBin: string;
  whisperBin: string;
  whisperModel: string;
  reaCommand: string[];
  chromeBin: string;
  chromeDebugPort: number;
  /** Keys for the public threat indexes a URL is checked against before she fetches it (each optional). */
  safeBrowsingKey?: string;
  urlhausKey?: string;
};

export type TtsEngine = "kokoro" | "say";

const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): JarvisConfig {
  const home = expandHome(env.JARVIS_HOME ?? "~/.jarvis");

  const effort = (env.JARVIS_EFFORT ?? "high") as EffortLevel;
  if (!EFFORTS.includes(effort)) {
    throw new Error(`JARVIS_EFFORT must be one of ${EFFORTS.join(", ")}, got "${effort}"`);
  }

  const tts = (env.JARVIS_TTS ?? "kokoro") as TtsEngine;
  if (tts !== "kokoro" && tts !== "say") throw new Error(`JARVIS_TTS must be kokoro or say, got "${tts}"`);
  const sayVoice = env.JARVIS_SAY_VOICE ?? "Daniel";

  const reaCommand = (env.JARVIS_REA_COMMAND ?? "rea mcp").trim().split(/\s+/);
  if (reaCommand[0] === undefined || reaCommand[0] === "") {
    throw new Error("JARVIS_REA_COMMAND must not be empty");
  }

  return {
    home,
    brainDir: expandHome(env.JARVIS_BRAIN_DIR ?? path.join(home, "brain")),
    workspaceDir: expandHome(env.JARVIS_WORKSPACE_DIR ?? path.join(home, "workspace")),
    model: env.JARVIS_MODEL ?? "claude-opus-5-5",
    effort,
    tts,
    voice: env.JARVIS_VOICE ?? (tts === "kokoro" ? "bf_emma" : sayVoice),
    sayVoice,
    wakeWord: (env.JARVIS_WAKE ?? "on").toLowerCase() !== "off",
    pauseSec: positiveNumber(env.JARVIS_PAUSE_SEC, 2, "JARVIS_PAUSE_SEC"),
    micGainDb: env.JARVIS_MIC_GAIN_DB === "0" ? 0 : positiveNumber(env.JARVIS_MIC_GAIN_DB, 18, "JARVIS_MIC_GAIN_DB"),
    ttsCacheDir: expandHome(env.JARVIS_TTS_CACHE_DIR ?? path.join(home, "models", "tts")),
    speechRate: positiveNumber(env.JARVIS_SPEECH_RATE, 190, "JARVIS_SPEECH_RATE"),
    maxListenMs: positiveNumber(env.JARVIS_MAX_LISTEN_SEC, 45, "JARVIS_MAX_LISTEN_SEC") * 1000,
    vadModel: expandHome(env.JARVIS_VAD_MODEL ?? path.join(home, "models", "silero_vad.onnx")),
    recorderBin: env.JARVIS_RECORDER_BIN ?? "rec",
    whisperBin: env.JARVIS_WHISPER_BIN ?? "whisper-cli",
    whisperModel: expandHome(env.JARVIS_WHISPER_MODEL ?? path.join(home, "models", "ggml-base.en.bin")),
    reaCommand,
    chromeBin: env.JARVIS_CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chromeDebugPort: positiveNumber(env.JARVIS_CHROME_DEBUG_PORT, 9222, "JARVIS_CHROME_DEBUG_PORT"),
    safeBrowsingKey: env.JARVIS_SAFE_BROWSING_KEY?.trim() || undefined,
    urlhausKey: env.JARVIS_URLHAUS_KEY?.trim() || undefined,
  };
}
