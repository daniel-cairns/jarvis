import { describe, expect, it } from "vitest";
import { decide, describeCall, parseAnswer } from "../src/permissions.js";
import { cleanTranscript } from "../src/voice/listener.js";
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
