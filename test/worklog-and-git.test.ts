import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { cdTarget, toolEvents, WorkLog } from "../src/ui/worklog.js";
import { parseNumstat, parsePorcelain } from "../src/tools/git.js";

const m = (o: object) => o as unknown as SDKMessage;

describe("toolEvents", () => {
  it("pulls tool calls and results out of top-level messages", () => {
    expect(toolEvents(m({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }))).toEqual([
      { kind: "use", id: "t1", name: "Bash", input: { command: "ls" } },
    ]);
    expect(toolEvents(m({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a.txt" }], is_error: false }] } }))).toEqual([
      { kind: "result", id: "t1", output: "a.txt", isError: false },
    ]);
    expect(toolEvents(m({ type: "assistant", parent_tool_use_id: "sub", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: {} }] } }))).toEqual([]);
  });
});

describe("WorkLog", () => {
  it("records commands with their folder and output, and tracks touched folders", () => {
    const log = new WorkLog();
    expect(log.record("Astra", "/w", { kind: "use", id: "1", name: "Bash", input: { command: "cd /repo/app && npm test" } })).toEqual({ terminal: true, files: false });
    expect(log.entries[0]).toMatchObject({ source: "Astra", command: "cd /repo/app && npm test", cwd: "/repo/app", status: "running" });
    log.record("Astra", "/w", { kind: "result", id: "1", output: "\u001b[32m12 passed\u001b[0m", isError: false });
    expect(log.entries[0]).toMatchObject({ output: "12 passed", status: "ok" });
    expect(log.record("gymclaw", "/g", { kind: "use", id: "2", name: "Edit", input: { file_path: "src/a.ts" } })).toEqual({ terminal: false, files: false });
    expect(log.record("gymclaw", "/g", { kind: "result", id: "2", output: "ok", isError: false })).toEqual({ terminal: false, files: true });
    expect(log.touched).toEqual(["/g/src", "/repo/app"]);
  });

  it("finds the folder a command cds into", () => {
    expect(cdTarget('cd "/a b" && ls', "/w")).toBe("/a b");
    expect(cdTarget("cd sub; make", "/w")).toBe("/w/sub");
    expect(cdTarget("npm test", "/w")).toBeNull();
  });
});

describe("git parsing", () => {
  it("reads porcelain status, including renames and untracked files", () => {
    expect(parsePorcelain(" M src/a.ts\n?? new.md\nR  old.ts -> renamed.ts\n")).toEqual([
      { path: "src/a.ts", status: " M" },
      { path: "new.md", status: "??" },
      { path: "renamed.ts", status: "R " },
    ]);
  });

  it("sums numstat line counts across staged and unstaged", () => {
    const counts = parseNumstat("3\t1\tsrc/a.ts\n2\t0\tsrc/a.ts\n-\t-\timg.png\n");
    expect(counts.get("src/a.ts")).toEqual({ added: 5, removed: 1 });
    expect(counts.get("img.png")).toEqual({ added: 0, removed: 0 });
  });
});
