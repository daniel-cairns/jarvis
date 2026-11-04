import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Panel = { kind: string; lastUsed: number; focused: boolean; pinned: boolean };
const { housekeep, overCap, IDLE_MS, REJOIN_MS, MAX_OPEN } = createRequire(import.meta.url)("../orb/housekeeping.cjs") as {
  housekeep(panels: Panel[], now: number): { close: string[]; rejoin: string[] };
  overCap(panels: Panel[], keep: string): string[];
  IDLE_MS: number;
  REJOIN_MS: number;
  MAX_OPEN: number;
};

const now = 100 * 60_000;
const panel = (kind: string, unusedMs: number, extra: Partial<Panel> = {}): Panel => ({ kind, lastUsed: now - unusedMs, focused: false, pinned: false, ...extra });

describe("panel housekeeping", () => {
  it("closes panels nobody has used for a while, and leaves recent ones", () => {
    const { close } = housekeep([panel("detail", IDLE_MS), panel("graph", IDLE_MS - 1)], now);
    expect(close).toEqual(["detail"]);
  });

  it("never closes the panel Dan is in, or the full Tallyline app", () => {
    const { close } = housekeep([panel("brain", IDLE_MS * 3, { focused: true }), panel("tallyline-app", IDLE_MS * 3)], now);
    expect(close).toEqual([]);
  });

  it("brings a hand-placed panel back into the layout once it's been left a while, before it would close", () => {
    expect(REJOIN_MS).toBeLessThan(IDLE_MS);
    expect(housekeep([panel("git", REJOIN_MS - 1, { pinned: true })], now)).toEqual({ close: [], rejoin: [] });
    expect(housekeep([panel("git", REJOIN_MS, { pinned: true })], now)).toEqual({ close: [], rejoin: ["git"] });
    expect(housekeep([panel("git", REJOIN_MS, { pinned: true, focused: true })], now)).toEqual({ close: [], rejoin: [] });
  });

  it("keeps no more than a few panels open, closing the ones used longest ago and never the new one", () => {
    const open = [panel("detail", 40_000), panel("graph", 30_000), panel("terminal", 20_000), panel("git", 10_000), panel("sessions", 0)];
    expect(open).toHaveLength(MAX_OPEN + 1);
    expect(overCap(open, "sessions")).toEqual(["detail"]);
    expect(overCap([...open, panel("brain", 50_000, { focused: true })], "sessions")).toEqual(["detail", "graph"]);
    expect(overCap(open.slice(0, MAX_OPEN), "git")).toEqual([]);
  });
});
