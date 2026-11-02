import { describe, expect, it } from "vitest";
import { WindowHistory, type WindowEntry, type WindowKind } from "../src/ui/windows.js";

const entry = (kind: WindowKind, title: string, request: number, at: number, opened: string[]): WindowEntry => ({
  key: `${kind}:${title}`,
  kind,
  title,
  request,
  at,
  reopen: () => void opened.push(title),
});

describe("WindowHistory", () => {
  const now = Date.UTC(2026, 10, 2, 12);
  const setUp = () => {
    const opened: string[] = [];
    const h = new WindowHistory(4);
    h.record(entry("detail", "Igloo teardown", 1, now - 20 * 60_000, opened));
    h.record(entry("graph", "Igloo teardown", 1, now - 19 * 60_000, opened));
    h.record(entry("terminal", "Terminal", 2, now - 5 * 60_000, opened));
    h.record(entry("detail", "Sit rep", 2, now - 60_000, opened));
    return { h, opened };
  };

  it("finds a window by title or by kind, newest first on a tie", () => {
    const { h } = setUp();
    expect(h.find("show me the sit rep again")?.title).toBe("Sit rep");
    expect(h.find("the terminal")?.kind).toBe("terminal");
    expect(h.find("igloo map")?.kind).toBe("graph");
    expect(h.find("the igloo teardown")?.kind).toBe("graph");
    expect(h.find("show me again")).toBeUndefined();
    expect(h.find("gymclaw")).toBeUndefined();
    h.record(entry("transcript", "Transcript: super-potato (s1)", 3, now, []));
    expect(h.find("show me the transcript")?.kind).toBe("transcript");
  });

  it("knows which windows came from the latest request", () => {
    const { h } = setUp();
    expect(h.latest().map((e) => e.title)).toEqual(["Sit rep", "Terminal"]);
  });

  it("replaces an older entry for the same window and keeps only the newest few", () => {
    const { h, opened } = setUp();
    h.record(entry("terminal", "Terminal", 3, now, opened));
    expect(h.list().map((e) => `${e.kind}:${e.title}`)).toEqual(["terminal:Terminal", "detail:Sit rep", "graph:Igloo teardown", "detail:Igloo teardown"]);
    h.record(entry("brain", "Brain browser", 3, now, opened));
    expect(h.list()).toHaveLength(4);
    expect(h.describe(now)).toContain("- Sit rep (detail panel, 1 min ago)");
  });
});
