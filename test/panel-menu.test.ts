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
  it("always offers the thinking window, worded for its state, without gendered labels", () => {
    expect(menuItems({ cardShown: false, panels: [] })).toEqual([{ id: "card", label: "Show the thinking window" }]);
    expect(menuItems({ cardShown: true, panels: [] })[0]).toEqual({ id: "card", label: "Fold the thinking window" });
  });

  it("lists every known panel, transcript first, worded for its state, with bring-all when any is showing", () => {
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
    expect(items).toEqual([
      { id: "card", label: "Show the thinking window" },
      { id: "front", label: "Bring all panels forward" },
      { id: "transcript", label: "Unfold: transcript" },
      { id: "terminal", label: "Bring forward: terminal" },
      { id: "git", label: "Reopen: git changes" },
      { id: "graph", label: "Reopen: map" },
    ]);
  });

  it("leaves out bring-all when every panel is closed", () => {
    const ids = menuItems({ cardShown: true, panels: [{ kind: "detail", state: "closed" }] }).map((i) => i.id);
    expect(ids).toEqual(["card", "detail"]);
  });
});
