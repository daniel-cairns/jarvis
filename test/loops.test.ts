import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Loops, loopsContext, plateHeadline, plateMarkdown } from "../src/loops.js";
import { localCommand } from "../src/ui/control.js";

const home = () => mkdtempSync(path.join(os.tmpdir(), "astra-loops-"));

describe("open loops", () => {
  it("opens and closes loops on file, shared between instances", () => {
    const dir = home();
    const a = new Loops(dir);
    const card = a.add("decision", "Add Start epic to Quench?");
    a.add("run", "Build the gate inspector", "Quench");
    const b = new Loops(dir);
    expect(b.open().map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(b.close(card.id, "Yes, after Q2")).toBe(true);
    expect(a.close(card.id, "again")).toBe(false);
    expect(a.open().map((l) => l.text)).toEqual(["Build the gate inspector"]);
    expect(a.all().find((l) => l.id === "l1")?.outcome).toBe("Yes, after Q2");
    expect(JSON.parse(readFileSync(path.join(dir, "loops.json"), "utf8"))).toHaveLength(2);
  });

  it("closes what a restart ended, and forgets closed loops after a week", () => {
    const dir = home();
    let now = new Date("2026-11-04T09:00:00Z");
    const loops = new Loops(dir, () => now);
    loops.add("run", "Temper plan", "Temper");
    loops.add("later", "Push the voice fixes");
    expect(loops.closeWhere((l) => l.kind === "run", "ended when Astra restarted")).toBe(1);
    now = new Date("2026-11-12T09:00:00Z");
    loops.add("later", "Accept the Xcode licence");
    expect(loops.all().map((l) => l.text)).toEqual(["Push the voice fixes", "Accept the Xcode licence"]);
  });
});

describe("the plate", () => {
  const open = [
    { id: "l1", kind: "run" as const, text: "Build the gate inspector", source: "Quench", openedAt: "" },
    { id: "l2", kind: "decision" as const, text: "Go with TypeScript?", openedAt: "" },
    { id: "l3", kind: "later" as const, text: "Push the voice fixes", openedAt: "" },
  ];

  it("leads with what's waiting on Dan", () => {
    expect(plateHeadline(open)).toBe("2 things for you. First: Go with TypeScript? And 1 run going.");
    expect(plateHeadline([open[0]!])).toBe("Nothing's waiting on you; 1 run going.");
    expect(plateHeadline([])).toBe("Nothing's waiting on you.");
  });

  it("groups the panel by kind, decisions first", () => {
    expect(plateMarkdown(open)).toBe(
      "## Waiting on your answer\n- Go with TypeScript?\n\n## Running for you\n- Build the gate inspector (Quench)\n\n## For later\n- Push the voice fixes",
    );
  });

  it("gives her the open loops as context, or nothing", () => {
    expect(loopsContext(open)).toContain("- [l2] decision: Go with TypeScript?");
    expect(loopsContext([])).toBe("");
  });

  it.each(["What's on my plate?", "Astra, what's waiting on me", "show my plate"])("hears %j as show_plate", (s) => {
    expect(localCommand(s)).toEqual({ ui: { action: "show_plate" } });
  });
});
