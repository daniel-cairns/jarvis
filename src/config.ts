import os from "node:os";
import path from "node:path";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

export type JarvisConfig = {
  home: string;
  brainDir: string;
  workspaceDir: string;
  model: string;
  effort: EffortLevel;
  maxBudgetUsd: number;
  voice: string;
  speechRate: number;
  recorderBin: string;
  whisperBin: string;
  whisperModel: string;
  reaCommand: string[];
  chromeBin: string;
  chromeDebugPort: number;
};

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
    maxBudgetUsd: positiveNumber(env.JARVIS_MAX_BUDGET_USD, 5, "JARVIS_MAX_BUDGET_USD"),
    voice: env.JARVIS_VOICE ?? "Daniel",
    speechRate: positiveNumber(env.JARVIS_SPEECH_RATE, 190, "JARVIS_SPEECH_RATE"),
    recorderBin: env.JARVIS_RECORDER_BIN ?? "rec",
    whisperBin: env.JARVIS_WHISPER_BIN ?? "whisper-cli",
    whisperModel: expandHome(env.JARVIS_WHISPER_MODEL ?? path.join(home, "models", "ggml-base.en.bin")),
    reaCommand,
    chromeBin: env.JARVIS_CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chromeDebugPort: positiveNumber(env.JARVIS_CHROME_DEBUG_PORT, 9222, "JARVIS_CHROME_DEBUG_PORT"),
  };
}
