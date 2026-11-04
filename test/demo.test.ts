import { describe, expect, it } from "vitest";
import { DEMO_GRAPH, runDemo, type DemoDeps } from "../src/demo.js";
import { checkGraph } from "../src/ui/graph.js";
import { localCommand } from "../src/ui/control.js";
import type { ToOrb } from "../src/ui/orb.js";

/** Fake orb and voice: records what the demo sends and says; waits and cards resolve at once. */
function fakes(onSay?: (text: string) => void) {
  const sent: ToOrb[] = [];
  const said: string[] = [];
  let restored = 0;
  const deps: DemoDeps = {
    send: (msg) => sent.push(msg),
    say: async (text) => {
      said.push(text);
      onSay?.(text);
    },
    render: (md) => `<p>${md}</p>`,
    question: async () => ["Teal"],
    ask: async () => "no",
    restore: () => restored++,
    wait: async () => {},
  };
  return { deps, sent, said, restored: () => restored };
}

describe("demo mode", () => {
  it("shows every orb state, every activity glyph and both transfer directions", async () => {
    const { deps, sent } = fakes();
    await runDemo(deps, new AbortController().signal);
    const states = new Set(sent.flatMap((m) => (m.type === "state" ? [m.state] : [])));
    expect(states).toEqual(new Set(["listening", "thinking", "idle"]));
    const glyphs = new Set(sent.flatMap((m) => (m.type === "activity" && m.glyph ? [m.glyph] : [])));
    expect(glyphs).toEqual(new Set(["sun", "eye", "ankh", "djed", "water", "reed"]));
    const transfers = sent.flatMap((m) => (m.type === "transfer" ? [m.dir] : []));
    expect(transfers).toEqual(["up", "down", null]);
    for (const kind of ["detail", "sessions", "graph", "terminal", "git", "tallyline", "guard", "control", "recording", "coffee"]) {
      expect(sent.some((m) => m.type === kind), kind).toBe(true);
    }
  });

  it("answers a clicked card and ends with her panels closed and her modes put back", async () => {
    const { deps, sent, said, restored } = fakes();
    await runDemo(deps, new AbortController().signal);
    expect(said).toContain("Teal. Noted.");
    expect(sent.at(-1)).toEqual({ type: "ui", action: "close_panels" });
    expect(restored()).toBeGreaterThan(0);
  });

  it("stops at once when stopped, and still puts everything back", async () => {
    const abort = new AbortController();
    const { deps, said, sent, restored } = fakes((text) => {
      if (text.startsWith("When you say my name")) abort.abort();
    });
    await runDemo(deps, abort.signal);
    expect(said).toHaveLength(2);
    expect(sent.some((m) => m.type === "graph")).toBe(false);
    expect(sent.at(-1)).toEqual({ type: "ui", action: "close_panels" });
    expect(restored()).toBe(1);
  });

  it("uses a map the map window accepts", () => {
    expect(() => checkGraph(DEMO_GRAPH)).not.toThrow();
  });

  it.each(["demo mode", "Astra, start the demo", "show off", "show me what you can do", "give me a tour"])("hears %j as /demo", (s) => {
    expect(localCommand(s)).toEqual({ slash: "/demo" });
  });

  it("still hears \"what can you do\" as help", () => {
    expect(localCommand("what can you do")).toEqual({ slash: "/help" });
  });
});
