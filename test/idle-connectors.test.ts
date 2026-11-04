import { describe, expect, it } from "vitest";
import { idleConnectors, NEEDS_APP } from "../src/idleConnectors.js";

describe("idleConnectors", () => {
  it("stands in for Unity's connector while the Unity editor is closed, so requests don't wait 30 s for it", () => {
    expect(NEEDS_APP["unity-mcp"]).toBe("Unity");
    expect(idleConnectors(() => false)).toEqual({ "unity-mcp": { type: "stdio", command: "/usr/bin/true", args: [] } });
  });

  it("leaves it alone while Unity is open", () => {
    expect(idleConnectors((app) => app === "Unity")).toEqual({});
  });
});
