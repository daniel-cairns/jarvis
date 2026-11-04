/** Mock Claude Code sessions Astra is commanding (God mode satellites). */
export const SESSIONS = [
  { id: "s1", name: "Checkout redesign", state: "working" },
  { id: "s2", name: "Astra voice tuning", state: "idle" },
  { id: "s3", name: "Budget sync fix", state: "waiting" },
  { id: "s4", name: "Phanio kit export", state: "working" },
];

/** Mock sessions and loops shown on the slate and the plate. */
export const ENTRIES = [
  { id: "e1", title: "Checkout redesign", glyph: "working", line: "Rebuilding the payment step", time: "09:42", lastAction: "Edited CheckoutStep.vue", needs: "Nothing yet" },
  { id: "e2", title: "Budget sync fix", glyph: "waiting", line: "Needs your go-ahead to push", time: "09:31", lastAction: "Ran the test suite (all green)", needs: "Approve the push to main" },
  { id: "e3", title: "Astra voice tuning", glyph: "idle", line: "Paused between takes", time: "09:05", lastAction: "Rendered Kokoro Emma sample", needs: "Nothing" },
  { id: "e4", title: "Orb ether fix", glyph: "done", line: "Shipped and verified", time: "08:50", lastAction: "Committed 77c2239", needs: "Nothing" },
  { id: "e5", title: "Cratedigga CI", glyph: "failed", line: "Lint step broke", time: "08:44", lastAction: "CI run failed on lint", needs: "Decide: fix now or park it" },
  { id: "e6", title: "Old worktree", glyph: "teardown", line: "Clearing up a finished branch", time: "08:30", lastAction: "Removed node_modules", needs: "Nothing" },
  { id: "e7", title: "Kokoro voices", glyph: "researching", line: "Comparing voice models", time: "08:12", lastAction: "Read three model cards", needs: "Nothing yet" },
];

/** Events cycled through by "Add a mock event". */
export const MOCK_EVENTS = [
  { title: "Brain note", glyph: "note", line: "Saved a note on the slate brief", lastAction: "Wrote 2026-11-04 note", needs: "Nothing" },
  { title: "Nightly tidy", glyph: "background", line: "Running quietly in the background", lastAction: "Started brain tidy loop", needs: "Nothing" },
  { title: "Phanio kit export", glyph: "done", line: "Export finished", lastAction: "Wrote kit-12.zip", needs: "Nothing" },
  { title: "Checkout redesign", glyph: "waiting", line: "Needs a decision on the layout", lastAction: "Drafted two layouts", needs: "Pick layout A or B" },
  { title: "Gymclaw plan", glyph: "researching", line: "Looking up progression schemes", lastAction: "Read two articles", needs: "Nothing yet" },
  { title: "Deploy preview", glyph: "failed", line: "Build ran out of memory", lastAction: "Vite build killed", needs: "Raise the memory limit?" },
  { title: "Spare session", glyph: "teardown", line: "Shutting down an idle session", lastAction: "Closed terminal tab", needs: "Nothing" },
  { title: "Brain index", glyph: "working", line: "Re-indexing notes", lastAction: "Indexed 140 notes", needs: "Nothing yet" },
];
