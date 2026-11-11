import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { noteMap, saveNote } from "../src/tools/brain.js";
import { readGraph } from "../src/ui/graph.js";

describe("readGraph: maps saved in older shapes still open", () => {
  it("reads `type` as a node's group, mapping names it doesn't know (Signal's map)", () => {
    const g = readGraph({
      nodes: [
        { id: "signal", label: "Signal", type: "app" },
        { id: "db", label: "SQLCipher", type: "datastore" },
        { id: "x", label: "Odd one", type: "gizmo" },
      ],
      edges: [{ source: "signal", target: "db", label: "stores in" }],
    });
    expect(g.nodes.map((n) => n.group)).toEqual(["app", "data", "other"]);
    expect(g.nodes[0]).not.toHaveProperty("type");
  });

  it("reads `from`/`to` as an edge's ends, and `links` as the edges (Jira's map)", () => {
    const g = readGraph({ nodes: [{ id: "a", label: "A", group: "app" }, { id: "b", label: "B", group: "module" }], links: [{ from: "a", to: "b", inferred: true }] });
    expect(g.edges).toEqual([{ source: "a", target: "b", inferred: true }]);
  });

  it("says briefly why a map can't be read, instead of a schema dump", () => {
    expect(() => readGraph({ nodes: [], edges: [] })).toThrow(/^The map isn't readable \(nodes: /);
    expect(() => readGraph({ nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "ghost" }] })).toThrow(/unknown node ids: ghost/);
  });
});

describe("saveNote keeps every saved map openable", () => {
  it("rewrites a note's map in the shape the map window reads", async () => {
    const brain = await fs.mkdtemp(path.join(os.tmpdir(), "brain-map-"));
    const body = '# Jira\n\n```astra-graph\n{"nodes":[{"id":"a","label":"A","type":"library"}],"edges":[]}\n```\n';
    const saved = await saveNote(brain, { title: "jira", body, folder: "teardowns" });
    expect(await noteMap(brain, saved)).toEqual({ nodes: [{ id: "a", label: "A", group: "framework" }], edges: [] });
  });

  it("refuses a map that isn't JSON, so no note gets a Show map that does nothing", async () => {
    const brain = await fs.mkdtemp(path.join(os.tmpdir(), "brain-map-"));
    await expect(saveNote(brain, { title: "bad", body: "```astra-graph\n{nodes: oops}\n```" })).rejects.toThrow(/isn't valid JSON/);
  });
});

describe("noteBody", () => {
  it("drops the front matter and the opening # Title, so the brain browser shows the title once", async () => {
    const { noteBody } = await import("../src/tools/brain.js");
    const text = '---\ntitle: "Signal teardown"\n---\n\n# Signal teardown\n\nTarget: Signal.app\n\n## Summary\n';
    expect(noteBody(text)).toBe("Target: Signal.app\n\n## Summary\n");
  });

  it("keeps a heading that isn't the note's first line, and notes without one", async () => {
    const { noteBody } = await import("../src/tools/brain.js");
    expect(noteBody("Intro first.\n\n# Later heading\n")).toBe("Intro first.\n\n# Later heading\n");
    expect(noteBody("## Summary\nText")).toBe("## Summary\nText");
  });
});
