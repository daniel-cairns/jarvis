// What the status indicator's dropdown offers: the thinking window first, then "bring all forward" when any panel is
// open, then every panel she's shown: open ones to bring forward, folded ones to unfold, closed ones to reopen.
// Shared with the tests, so it has no DOM in it.
(function (root) {
  const NAMES = {
    transcript: "transcript",
    terminal: "terminal",
    git: "git changes",
    detail: "detail panel",
    graph: "map",
    brain: "brain browser",
    sessions: "sessions panel",
    tallyline: "Tallyline panel",
    "tallyline-app": "full Tallyline",
  };
  const ORDER = ["transcript", "terminal", "git", "detail", "graph", "brain", "sessions", "tallyline", "tallyline-app"];
  const VERB = { open: "Bring forward", collapsed: "Unfold", closed: "Reopen" };

  /**
   * cardShown: the thinking window is visible and unfolded. panels: [{ kind, state: "open" | "collapsed" | "closed" }].
   * Every item but "card" and "front" is a panel kind; choosing one brings that panel up whatever its state.
   */
  function menuItems({ cardShown, panels }) {
    const items = [{ id: "card", label: cardShown ? "Fold the thinking window" : "Show the thinking window" }];
    const known = panels.filter((p) => NAMES[p.kind] && VERB[p.state]);
    if (known.some((p) => p.state !== "closed")) items.push({ id: "front", label: "Bring all panels forward" });
    const sorted = [...known].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    for (const p of sorted) items.push({ id: p.kind, label: `${VERB[p.state]}: ${NAMES[p.kind]}` });
    return items;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { menuItems };
  else root.astraPanelMenu = { menuItems };
})(globalThis);
