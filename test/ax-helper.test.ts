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
    expect(focus).toMatch(/bringForward\(el\)/);
    const bring = source.slice(source.indexOf("func bringForward("), source.indexOf("/// Refuses to type unless"));
    expect(bring).toMatch(/\.activate\(\)/);
    expect(bring).toMatch(/kAXRaiseAction/);
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

  it("brings the app forward before pressing, so the keys that follow reach it", () => {
    const press = source.slice(source.indexOf('case "press":'), source.indexOf('case "focus":'));
    expect(press.indexOf("bringForward(el)")).toBeGreaterThan(-1);
    expect(press.indexOf("bringForward(el)")).toBeLessThan(press.indexOf("kAXPressAction"));
  });

  it("refuses to pick between several running copies of an app by name", () => {
    expect(source).toMatch(/code: "ambiguous"/);
  });
});

describe("the orb", () => {
  const main = readFileSync(new URL("../orb/main.cjs", import.meta.url), "utf8");

  it("never focuses itself when a card appears (that made Astra the active app)", () => {
    // The one exception: Dan switching to her (Cmd-Tab, her Dock icon), where taking the keyboard is the point.
    const summon = main.slice(main.indexOf("const summon = async"), main.indexOf('require("node:fs").watch(home'));
    expect(summon).toMatch(/\bwin\.focus\(\)/);
    expect(main.replace(summon, "")).not.toMatch(/\bwin\.focus\(\)/);
  });

  it("never drops a window that already floats (her orb) when lifting it to the front", () => {
    const lift = main.slice(main.indexOf("const bringForward = (w) =>"), main.indexOf("/** The on-screen windows"));
    expect(lift.indexOf("w.isAlwaysOnTop()")).toBeGreaterThan(-1);
    expect(lift.indexOf("w.isAlwaysOnTop()")).toBeLessThan(lift.indexOf("w.setAlwaysOnTop(false)"));
    const summon = main.slice(main.indexOf("const summon = async"), main.indexOf('require("node:fs").watch(home'));
    expect(summon).not.toMatch(/bringForward\(win\)/);
  });

  it("keeps work panels from popping up over an app she's operating", () => {
    expect(main).toMatch(/Date\.now\(\) - lastControlAt < CONTROL_QUIET_MS/);
  });

  it("keeps closed panels closed: close_panels covers every kind and nothing clears it on a new request", () => {
    const close = main.slice(main.indexOf('action === "close_panels"'), main.indexOf('action === "show_last_detail"'));
    expect(close).toMatch(/closed\.add\(kind\)/);
    expect(close).not.toMatch(/kind === "terminal"/);
    const reset = main.slice(main.indexOf('m.type === "activity-reset"'), main.indexOf('m.type === "brain-note"'));
    expect(reset).not.toMatch(/closed\.clear/);
    // A background run's transcript (no owner) never reopens a closed panel.
    expect(main).toMatch(/m\.type === "transcript" && m\.owner !== "user" && closed\.has\("transcript"\)/);
  });

  it("only judges whether typing landed in the same text field it started in", () => {
    const typeCase = source.slice(source.indexOf('case "type":'), source.indexOf('case "key":'));
    expect(typeCase).toMatch(/CFEqual\(fieldBefore!, fieldAfter!\)/);
    expect(typeCase).toMatch(/sameField, isTextInput\(fieldAfter!\)/);
  });
});
