import { describe, expect, it } from "vitest";
import { describeActivity } from "../src/activity.js";

describe("describeActivity", () => {
  it("says what Astra is doing in plain English", () => {
    expect(describeActivity("mcp__jarvis__brain_search")).toBe("Searching your brain…");
    expect(describeActivity("mcp__rea__inspect_web_page")).toBe("Inspecting with REA: inspect web page…");
    expect(describeActivity("Write")).toBe("Writing code…");
    expect(describeActivity("Bash")).toBe("Running a command…");
    expect(describeActivity("mcp__notion__search")).toBe("Using notion…");
  });

  it("falls back to a neutral line for anything unknown", () => {
    expect(describeActivity("SomethingNew")).toBe("Working…");
    expect(describeActivity("mcp__jarvis__new_tool")).toBe("Working…");
  });
});
