import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { decide, describeCall, parseAnswer, spokenQuestion } from "../src/permissions.js";
import { parseDialogResult } from "../src/ui/dialog.js";
import { cleanTranscript, stopGracefully } from "../src/voice/listener.js";
import { chunkForSpeech, toSpeakable } from "../src/voice/speechText.js";

describe("toSpeakable", () => {
  it("strips markdown that sounds wrong aloud", () => {
    const md = "## Summary\n- **Fast** load\n- See [docs](https://x.io)\n```js\nconst a = 1\n```\nRun `npm test` at https://a.b/c";
    const out = toSpeakable(md);
    expect(out).toContain("Summary.");
    expect(out).toContain("Fast load");
    expect(out).toContain("See docs");
    expect(out).toContain("(code omitted)");
    expect(out).toContain("Run npm test at a link");
    expect(out).not.toMatch(/[#*`\[\]]/);
  });

  it("flattens tables", () => {
    expect(toSpeakable("| a | b |\n|---|---|\n| 1 | 2 |")).not.toContain("|");
  });
});

describe("chunkForSpeech", () => {
  it("splits on sentences and caps chunk length", () => {
    expect(chunkForSpeech("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
    const long = Array.from({ length: 100 }, () => "word").join(" ");
    const chunks = chunkForSpeech(long, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });
});

describe("cleanTranscript", () => {
  it("drops whisper's non-speech markers", () => {
    expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscript("(music) Jarvis, open Notes.\n")).toBe("Jarvis, open Notes.");
  });
});

describe("stopGracefully", () => {
  const nodeChild = (script: string) => spawn(process.execPath, ["-e", script], { stdio: "ignore" });
  const ready = () => new Promise((r) => setTimeout(r, 200));

  it("stops a recorder that honours SIGINT without escalating", async () => {
    const child = nodeChild("process.on('SIGINT', () => process.exit(0)); setInterval(() => {}, 1000)");
    await ready();
    await stopGracefully(child, 5_000);
    expect(child.exitCode).toBe(0);
  });

  it("escalates when SIGINT is ignored, so push-to-talk can't hang", async () => {
    const child = nodeChild("process.on('SIGINT', () => {}); setInterval(() => {}, 1000)");
    await ready();
    await stopGracefully(child, 100);
    expect(child.signalCode).toBe("SIGTERM");
  });
});

describe("decide", () => {
  const ctx = { workspaceDir: "/Users/dan/.jarvis/workspace", sessionAllowed: new Set<string>() };

  it("allows Jarvis tools and read-only built-ins", () => {
    expect(decide("mcp__jarvis__brain_save", {}, ctx)).toBe("allow");
    expect(decide("Read", { file_path: "/etc/hosts" }, ctx)).toBe("allow");
  });

  it("allows writes only inside the workspace", () => {
    expect(decide("Write", { file_path: "/Users/dan/.jarvis/workspace/notes-app/index.html" }, ctx)).toBe("allow");
    expect(decide("Write", { file_path: "notes-app/app.js" }, ctx)).toBe("allow");
    expect(decide("Write", { file_path: "/Users/dan/.zshrc" }, ctx)).toBe("ask");
    const withBrain = { ...ctx, brainDir: "/Users/dan/.jarvis/brain" };
    expect(decide("Edit", { file_path: "/Users/dan/.jarvis/brain/teardowns/notes.md" }, withBrain)).toBe("allow");
    expect(decide("Edit", { file_path: "/Users/dan/.jarvis/brain/../secrets.md" }, withBrain)).toBe("ask");
    expect(decide("Edit", { file_path: "/Users/dan/.jarvis/workspace/../escape" }, ctx)).toBe("ask");
  });

  it("asks for shell and REA unless allowed for the session", () => {
    expect(decide("Bash", { command: "ls" }, ctx)).toBe("ask");
    expect(decide("mcp__rea__inspect_web_page", {}, ctx)).toBe("ask");
    const allowed = { ...ctx, sessionAllowed: new Set(["mcp__rea__inspect_web_page"]) };
    expect(decide("mcp__rea__inspect_web_page", {}, allowed)).toBe("allow");
  });
});

describe("describeCall and parseAnswer", () => {
  it("describes calls briefly", () => {
    expect(describeCall("Bash", { command: "npm test" })).toBe("run the command: npm test");
    expect(describeCall("mcp__rea__inspect_web_page", { url: "x" })).toBe('use rea: inspect_web_page {"url":"x"}');
    expect(describeCall("Other", { blob: "z".repeat(500) }).length).toBeLessThan(200);
  });

  it("defaults to no", () => {
    expect(parseAnswer("Yes")).toBe("yes");
    expect(parseAnswer(" a ")).toBe("always");
    expect(parseAnswer("maybe later")).toBe("no");
    expect(parseAnswer("")).toBe("no");
  });
});

describe("spokenQuestion", () => {
  it("keeps JSON and paths out of what is read aloud", () => {
    expect(spokenQuestion("Bash", { command: "rm -rf x" })).toBe("May I run a shell command?");
    expect(spokenQuestion("mcp__rea__inspect_web_page", { cdp_endpoint: "http://127.0.0.1:9222" })).toBe(
      "May I use REA's inspect web page?",
    );
    expect(spokenQuestion("Write", { file_path: "/Users/dan/.zshrc" })).toBe("May I write .zshrc, outside your workspace?");
  });

  it("accepts whisper's punctuated answers", () => {
    expect(parseAnswer("Yes.")).toBe("yes");
    expect(parseAnswer(" Always! ")).toBe("always");
    expect(parseAnswer("No.")).toBe("no");
  });
});

describe("parseDialogResult", () => {
  it("maps buttons, Escape and timeouts", () => {
    expect(parseDialogResult(0, "Always\n", "")).toBe("always");
    expect(parseDialogResult(0, "timeout\n", "")).toBeNull();
    expect(parseDialogResult(1, "", "execution error: User canceled. (-128)")).toBe("no");
    expect(parseDialogResult(1, "", "some other failure")).toBeNull();
  });
});
