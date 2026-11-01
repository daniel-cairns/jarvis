import { describe, expect, it } from "vitest";
import { checkGraph, graphAsText, type TeardownGraph } from "../src/ui/graph.js";

const notes: TeardownGraph = {
  nodes: [
    { id: "app", label: "Notes", group: "app" },
    { id: "coredata", label: "Core Data", group: "data", detail: "Linked framework (REA Mach-O dependency list)." },
    { id: "cloudkit", label: "CloudKit", group: "service" },
  ],
  edges: [
    { source: "app", target: "coredata", label: "stores in" },
    { source: "coredata", target: "cloudkit", label: "syncs via", inferred: true },
  ],
};

describe("checkGraph", () => {
  it("accepts a well-formed map", () => {
    expect(checkGraph(notes)).toBe(notes);
  });

  it("names unknown edge ends and duplicate ids so the model can fix them", () => {
    const bad = { ...notes, nodes: [...notes.nodes, { id: "app", label: "Again", group: "app" as const }],
      edges: [...notes.edges, { source: "app", target: "spotlight" }] };
    expect(() => checkGraph(bad)).toThrow(/duplicate node ids: app.*unknown node ids: spotlight/);
  });
});

describe("graphAsText", () => {
  it("lists links in words, flagging inferred ones", () => {
    const text = graphAsText("Notes", notes);
    expect(text).toContain("Notes: 3 nodes, 2 links");
    expect(text).toContain("Notes stores in Core Data");
    expect(text).toContain("Core Data syncs via CloudKit (inferred)");
  });
});
