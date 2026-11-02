import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Panel = { kind: string; state: "open" | "collapsed" | "closed" };
// A plain browser script (the repo's .js files are ES modules to Node), so it's run in a sandbox with a CommonJS shim.
const sandbox = { module: { exports: {} as Record<string, unknown> }, globalThis: {} };
runInNewContext(readFileSync(new URL("../orb/panel-menu.js", import.meta.url), "utf8"), sandbox);
const { menuItems } = sandbox.module.exports as {
  menuItems(s: { cardShown: boolean; panels: Panel[] }): { id: string; label: string }[];
};

describe("the status indicator's dropdown", () => {
  it("always offers her thinking window, worded for its state", () => {
    expect(menuItems({ cardShown: false, panels: [] })).toEqual([{ id: "card", label: "Show her thinking window" }]);
    expect(menuItems({ cardShown: true, panels: [] })[0]).toEqual({ id: "card", label: "Fold her thinking window" });
  });

  it("lists closed and folded panels, transcript first, and leaves out open ones", () => {
    const items = menuItems({
      cardShown: false,
      panels: [
        { kind: "terminal", state: "open" },
        { kind: "graph", state: "closed" },
        { kind: "transcript", state: "collapsed" },
        { kind: "git", state: "closed" },
        { kind: "unknown", state: "closed" },
      ],
    });
    expect(items.map((i) => i.label)).toEqual([
      "Show her thinking window",
      "Unfold the transcript",
      "Reopen the git changes",
      "Reopen the last map",
    ]);
  });
});
