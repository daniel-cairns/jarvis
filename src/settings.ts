/** Small preferences Astra remembers between runs (in ~/.jarvis/settings.json), such as her speaking volume. */
import fs from "node:fs";
import path from "node:path";

export type Settings = { volume: number; typeOnly: boolean; godMode: boolean };

const DEFAULTS: Settings = { volume: 0.8, typeOnly: false, godMode: false };

export const clampVolume = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;

export function loadSettings(home: string): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8")) as Partial<Settings>;
    return {
      volume: typeof raw.volume === "number" ? clampVolume(raw.volume) : DEFAULTS.volume,
      typeOnly: raw.typeOnly === true,
      godMode: raw.godMode === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(home: string, settings: Settings): void {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}
