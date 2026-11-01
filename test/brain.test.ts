import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listNotes, readNote, resolveInside, saveNote, searchNotes, sections, slugify } from "../src/tools/brain.js";

let brain: string;
beforeEach(async () => {
  brain = await fs.mkdtemp(path.join(os.tmpdir(), "brain-test-"));
});
afterEach(async () => {
  await fs.rm(brain, { recursive: true, force: true });
});

const REPORT = `# igloo.inc teardown

Intro line.

## Summary
A 3D scroll site.

## Tech stack
WebGL and a scroll timeline.

\`\`\`
# not a heading inside a fence
\`\`\`

## Unknowns
Shader sources were minified.
`;

describe("slugify", () => {
  it("makes filesystem-safe slugs", () => {
    expect(slugify("Apple Notes: Teardown!")).toBe("apple-notes-teardown");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("???")).toBe("note");
  });
});

describe("resolveInside", () => {
  it("rejects paths that escape the brain", () => {
    expect(() => resolveInside(brain, "../secrets.md")).toThrow(/outside/);
    expect(() => resolveInside(brain, "/etc/passwd")).toThrow(/outside/);
    expect(() => resolveInside(brain, ".")).toThrow(/outside/);
    expect(resolveInside(brain, "notes/a.md")).toBe(path.join(brain, "notes/a.md"));
  });
});

describe("saveNote", () => {
  const now = new Date("2026-11-01T10:00:00Z");

  it("writes a dated note with front matter and never overwrites", async () => {
    const first = await saveNote(brain, { title: "igloo teardown", body: REPORT, folder: "teardowns", tags: ["Web GL"] }, now);
    const second = await saveNote(brain, { title: "igloo teardown", body: "v2", folder: "teardowns" }, now);
    expect(first).toBe("teardowns/2026-11-01-igloo-teardown.md");
    expect(second).toBe("teardowns/2026-11-01-igloo-teardown-2.md");
    const text = await fs.readFile(path.join(brain, first), "utf8");
    expect(text).toContain('title: "igloo teardown"');
    expect(text).toContain("tags: [web-gl]");
  });

  it("rejects folder names that could escape or surprise", async () => {
    await expect(saveNote(brain, { title: "x", body: "y", folder: "../out" })).rejects.toThrow(/Folder segment/);
    await expect(saveNote(brain, { title: "x", body: "y", folder: "Teardowns" })).rejects.toThrow(/Folder segment/);
  });
});

describe("search, list and read", () => {
  beforeEach(async () => {
    await saveNote(brain, { title: "igloo teardown", body: REPORT, folder: "teardowns" });
    await saveNote(brain, { title: "Shopping", body: "milk and eggs" });
  });

  it("ranks title matches above body matches and returns snippets", async () => {
    const hits = await searchNotes(brain, "igloo webgl");
    expect(hits[0]?.title).toBe("igloo teardown");
    expect(hits[0]?.snippet.length).toBeGreaterThan(0);
    expect(await searchNotes(brain, "x")).toEqual([]);
  });

  it("lists notes, optionally by folder", async () => {
    expect(await listNotes(brain)).toHaveLength(2);
    const teardowns = await listNotes(brain, "teardowns");
    expect(teardowns.map((n) => n.title)).toEqual(["igloo teardown"]);
    expect(await listNotes(brain, "missing")).toEqual([]);
  });

  it("reads one section at a time and lists headings", async () => {
    const [note] = await listNotes(brain, "teardowns");
    const whole = await readNote(brain, note!.path);
    expect(whole.sections).toEqual(["igloo.inc teardown", "Summary", "Tech stack", "Unknowns"]);

    const stack = await readNote(brain, note!.path, "tech");
    expect(stack.text).toContain("WebGL");
    expect(stack.text).toContain("# not a heading inside a fence");
    await expect(readNote(brain, note!.path, "pricing")).rejects.toThrow(/No section matching/);
  });
});

describe("sections", () => {
  it("handles notes with no headings", () => {
    expect(sections("just text")).toEqual([{ heading: "(intro)", body: "just text" }]);
  });
});
