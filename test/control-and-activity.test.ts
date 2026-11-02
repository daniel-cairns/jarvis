import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { activityDetail, activityGlyph, describeActivity, transferKind } from "../src/activity.js";
import { clampVolume, loadSettings, saveSettings } from "../src/settings.js";
import { quickUiCommand, localCommand, commandWords } from "../src/ui/control.js";
import { parseFromOrb } from "../src/ui/orb.js";

describe("quickUiCommand", () => {
  it("handles plain spoken commands instantly", () => {
    expect(quickUiCommand("minimise")).toEqual({ action: "minimise" });
    expect(quickUiCommand("Hide yourself.")).toEqual({ action: "minimise" });
    expect(quickUiCommand("come back")).toEqual({ action: "show" });
    expect(quickUiCommand("Restart yourself.")).toEqual({ action: "restart" });
    expect(quickUiCommand("restart the gymclaw session")).toBeNull();
    expect(quickUiCommand("Type only mode.")).toEqual({ action: "type_only" });
    expect(quickUiCommand("switch to voice mode")).toEqual({ action: "voice_mode" });
    expect(quickUiCommand("Sit rep.")).toEqual({ action: "sitrep" });
    expect(quickUiCommand("Stack your windows.")).toEqual({ action: "stack_windows" });
    expect(quickUiCommand("tidy up the panels please")).toEqual({ action: "stack_windows" });
    expect(quickUiCommand("give me a sitrep please")).toEqual({ action: "sitrep" });
    expect(quickUiCommand("What's everyone doing?")).toEqual({ action: "sitrep" });
    expect(quickUiCommand("God mode on")).toEqual({ action: "god_mode_on" });
    expect(quickUiCommand("turn off god mode")).toEqual({ action: "god_mode_off" });
    expect(quickUiCommand("Fold up.")).toEqual({ action: "minimise" });
    expect(quickUiCommand("close yourself")).toEqual({ action: "minimise" });
    expect(quickUiCommand("transform closed")).toEqual({ action: "minimise" });
    expect(quickUiCommand("unfold")).toEqual({ action: "show" });
    expect(quickUiCommand("open up")).toEqual({ action: "show" });
    expect(quickUiCommand("close the map")).toEqual({ action: "close_panels" });
    expect(quickUiCommand("open my brain")).toEqual({ action: "show_brain" });
    expect(quickUiCommand("show me the map again")).toEqual({ action: "show_last_map" });
    expect(quickUiCommand("collapse your panel")).toEqual({ action: "collapse_panel" });
    expect(quickUiCommand("Show me your terminal.")).toEqual({ action: "show_terminal" });
    expect(quickUiCommand("show the git changes")).toEqual({ action: "show_git" });
    expect(quickUiCommand("Expand the thinking window.")).toEqual({ action: "expand_panel" });
  });

  it("understands volume commands", () => {
    expect(quickUiCommand("Louder.")).toEqual({ action: "volume_up" });
    expect(quickUiCommand("turn it down please")).toEqual({ action: "volume_down" });
    expect(quickUiCommand("Volume 40%.")).toEqual({ action: "set_volume", level: 40 });
    expect(quickUiCommand("set the volume to 75 percent")).toEqual({ action: "set_volume", level: 75 });
  });

  it("leaves anything less direct to Claude", () => {
    expect(quickUiCommand("minimise the Notes app for me")).toBeNull();
    expect(quickUiCommand("what's in my brain about Spotify?")).toBeNull();
  });
});

describe("activity details", () => {
  it("adds a short, useful detail from the tool's input", () => {
    expect(describeActivity("mcp__jarvis__brain_read", { path: "teardowns/2026-11-01-teardown-macos-notes-app.md" })).toBe(
      "Reading a note: teardown macos notes app",
    );
    expect(describeActivity("Bash", { command: "npx nuxi generate\nnpm test" })).toBe("Running a command: npx nuxi generate");
    expect(describeActivity("WebFetch", { url: "https://example.com/a/b" })).toBe("Reading a web page: example.com");
    expect(describeActivity("Write", { file_path: "/Users/dan/.jarvis/workspace/quire/app.vue" })).toBe("Writing code: app.vue");
  });

  it("falls back to the plain phrase without a detail", () => {
    expect(describeActivity("mcp__jarvis__brain_list", {})).toBe("Looking through your notes…");
    expect(activityDetail("Bash", { command: "x".repeat(80) }).length).toBeLessThanOrEqual(48);
  });
});

describe("parseFromOrb (new messages)", () => {
  it("accepts question answers and brain browser requests", () => {
    expect(parseFromOrb('{"type":"question-answer","id":"2","answer":["Spotify"]}')).toEqual({ type: "question-answer", id: "2", answer: ["Spotify"] });
    expect(parseFromOrb('{"type":"typed","text":"sit rep"}')).toEqual({ type: "typed", text: "sit rep" });
    expect(parseFromOrb('{"type":"typed","text":"   "}')).toBeNull();
    expect(parseFromOrb('{"type":"question-answer","id":"2","answer":"Something else"}')).toMatchObject({ answer: "Something else" });
    expect(parseFromOrb('{"type":"brain-open","path":"teardowns/a.md"}')).toEqual({ type: "brain-open", path: "teardowns/a.md" });
    expect(parseFromOrb('{"type":"brain-request"}')).toEqual({ type: "brain-request" });
    expect(parseFromOrb('{"type":"git-diff","root":"/w/app","path":"src/a.ts"}')).toEqual({ type: "git-diff", root: "/w/app", path: "src/a.ts" });
  });

  it("rejects malformed ones", () => {
    expect(parseFromOrb('{"type":"question-answer","id":"2","answer":[1,2]}')).toBeNull();
    expect(parseFromOrb('{"type":"question-answer","id":"2","answer":"   "}')).toBeNull();
    expect(parseFromOrb(`{"type":"brain-open","path":"${"a".repeat(400)}"}`)).toBeNull();
  });
});

describe("activityGlyph", () => {
  it("gives each kind of work its glyph from the ring", () => {
    expect(activityGlyph("mcp__rea__inspect_web_page")).toBe("eye");
    expect(activityGlyph("mcp__jarvis__brain_read")).toBe("eye");
    expect(activityGlyph("Write")).toBe("ankh");
    expect(activityGlyph("Bash")).toBe("djed");
    expect(activityGlyph("WebSearch")).toBe("water");
    expect(activityGlyph("mcp__jarvis__ask_user")).toBe("reed");
    expect(activityGlyph("SomethingElse")).toBe("sun");
  });
});

describe("settings", () => {
  it("remembers the volume, clamped, and falls back to defaults", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "astra-settings-"));
    expect(loadSettings(home).volume).toBe(0.8);
    expect(loadSettings(home).typeOnly).toBe(false);
    saveSettings(home, { volume: clampVolume(1.7), typeOnly: true, godMode: true });
    expect(loadSettings(home)).toEqual({ volume: 1, typeOnly: true, godMode: true });
    fs.writeFileSync(path.join(home, "settings.json"), "not json");
    expect(loadSettings(home).volume).toBe(0.8);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("move commands", () => {
  it("reads spots on screen and nudges", () => {
    expect(quickUiCommand("Move to the top left.")).toEqual({ action: "move", position: "top_left" });
    expect(quickUiCommand("go to the centre")).toEqual({ action: "move", position: "centre" });
    expect(quickUiCommand("move to the bottom right corner")).toEqual({ action: "move", position: "bottom_right" });
    expect(quickUiCommand("move to the right side of the screen")).toEqual({ action: "move", position: "right" });
    expect(quickUiCommand("move a bit left")).toEqual({ action: "move", position: "nudge_left" });
    expect(quickUiCommand("move up please")).toEqual({ action: "move", position: "nudge_up" });
  });

  it("leaves other 'move' requests to Claude", () => {
    expect(quickUiCommand("move the file to my desktop")).toBeNull();
    expect(quickUiCommand("move on to the next step")).toBeNull();
  });
});

describe("localCommand", () => {
  it("catches interface commands wrapped in polite words or misheard", () => {
    expect(localCommand("Astra, could you please stack the windows for me?")).toEqual({ ui: { action: "stack_windows" } });
    expect(localCommand("Hey, give me a sit rap.")).toEqual({ ui: { action: "sitrep" } });
    expect(localCommand("Can you go into god mod please")).toEqual({ ui: { action: "god_mode_on" } });
    expect(localCommand("okay minimise yourself thanks")).toEqual({ ui: { action: "minimise" } });
  });

  it("turns spoken versions of the slash commands into them", () => {
    expect(localCommand("Start a new conversation, please.")).toEqual({ slash: "/new" });
    expect(localCommand("could you mute yourself")).toEqual({ slash: "/mute" });
    expect(localCommand("Take notes about the launch plan please")).toEqual({ slash: "/transcript the launch plan" });
    expect(localCommand("start recording")).toEqual({ slash: "/transcript" });
  });

  it("leaves real requests for her", () => {
    expect(localCommand("Could you stack the boxes in the warehouse app by size?")).toBeNull();
    expect(localCommand("mute the intro video in gymclaw")).toBeNull();
    expect(localCommand("/mute")).toBeNull();
    expect(commandWords("Um, Astra, just stack your windows now, thanks!")).toBe("stack your windows");
  });
});

describe("transferKind", () => {
  it("spots uploads", () => {
    expect(transferKind("Bash", { command: "git push origin main" })).toBe("up");
    expect(transferKind("Bash", { command: "cd app && npx wrangler pages deploy dist" })).toBe("up");
    expect(transferKind("Bash", { command: "curl -X POST https://api.example.com/x -d @body.json" })).toBe("up");
    expect(transferKind("Bash", { command: "scp build.zip pod:/workspace/" })).toBe("up");
    expect(transferKind("mcp__aee__media_upload", {})).toBe("up");
  });

  it("spots downloads", () => {
    expect(transferKind("Bash", { command: "git clone https://github.com/x/y" })).toBe("down");
    expect(transferKind("Bash", { command: "curl -sL https://example.com/model.bin -o model.bin" })).toBe("down");
    expect(transferKind("Bash", { command: "npm install three" })).toBe("down");
    expect(transferKind("Bash", { command: "scp pod:/workspace/out.png ./" })).toBe("down");
    expect(transferKind("WebFetch", { url: "https://x.dev" })).toBe("down");
    expect(transferKind("mcp__x__download_file_content", {})).toBe("down");
  });

  it("ignores everything else", () => {
    expect(transferKind("Bash", { command: "npm test" })).toBeNull();
    expect(transferKind("Read", { file_path: "/a/push.ts" })).toBeNull();
  });
});
