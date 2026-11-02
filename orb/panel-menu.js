// What the status indicator's dropdown offers: her thinking window first, then every panel that's closed or folded
// (transcript first). Shared with the tests, so it has no DOM in it.
(function (root) {
  const NAMES = {
    transcript: "transcript",
    terminal: "terminal",
    git: "git changes",
    detail: "last detail panel",
    graph: "last map",
    brain: "brain browser",
  };
  const ORDER = ["transcript", "terminal", "git", "detail", "graph", "brain"];

  /** cardShown: her thinking window is visible and unfolded. panels: [{ kind, state: "open" | "collapsed" | "closed" }]. */
  function menuItems({ cardShown, panels }) {
    const items = [{ id: "card", label: cardShown ? "Fold her thinking window" : "Show her thinking window" }];
    const sorted = [...panels].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    for (const p of sorted) {
      if (p.state === "open" || !NAMES[p.kind]) continue;
      items.push({ id: p.kind, label: `${p.state === "collapsed" ? "Unfold" : "Reopen"} the ${NAMES[p.kind]}` });
    }
    return items;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { menuItems };
  else root.astraPanelMenu = { menuItems };
})(globalThis);
