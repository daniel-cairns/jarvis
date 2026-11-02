import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The helper is Swift, built on demand, so it can't run in a unit test; these pin the two decisions that matter.
const source = readFileSync(new URL("../native/astra-ax.swift", import.meta.url), "utf8");

describe("astra-ax helper", () => {
  it("opens up Electron/Chromium trees with AXManualAccessibility, never AXEnhancedUserInterface", () => {
    expect(source).toMatch(/AXUIElementSetAttributeValue\(app, manualAccessibility, kCFBooleanTrue\)/);
    expect(source).toMatch(/"AXManualAccessibility"/);
    // AXEnhancedUserInterface breaks window animations and positioning.
    expect(source).not.toMatch(/AXUIElementSetAttributeValue\([^)]*AXEnhancedUserInterface/);
  });

  it("brings the element's app forward when focusing, since typing goes to the frontmost app", () => {
    const focus = source.slice(source.indexOf('case "focus":'), source.indexOf('case "click":'));
    expect(focus).toMatch(/\.activate\(\)/);
    expect(focus).toMatch(/kAXRaiseAction/);
  });

  it("presses and releases modifiers as real keys, and types with no modifiers held", () => {
    // Setting flags only on the key event left ⌘ stuck down, so later typing arrived as ⌘ shortcuts and was lost.
    const key = source.slice(source.indexOf("func key("), source.indexOf("let MODIFIER_KEYS"));
    expect(key).toMatch(/for m in mods \{/);
    expect(key).toMatch(/for m in mods\.reversed\(\)/);
    expect(source).toMatch(/\(\.maskCommand, 55\)/);
    const type = source.slice(source.indexOf("func typeText("), source.indexOf("// MARK: - Commands"));
    expect(type).toMatch(/e\?\.flags = \[\]/);
    expect(type).toMatch(/checkTarget\(expected\)/);
  });
});
