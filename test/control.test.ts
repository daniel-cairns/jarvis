import { describe, expect, it } from "vitest";
import { ComputerControl, type Helper } from "../src/control/computer.js";
import { confirmationReason, isSecureField, normaliseCombo, StoppedError, typingChunks, type UiElement } from "../src/control/safety.js";

/** A stand-in for the native helper: records calls, answers from a table. */
function fakeHelper(answers: Record<string, (input: any) => unknown> = {}) {
  const calls: { command: string; input: any }[] = [];
  const helper: Helper = async (command, input) => {
    calls.push({ command, input });
    if (command === "perms") return { accessibility: true, screenRecording: true };
    const answer = answers[command];
    return answer ? answer(input) : { ok: true };
  };
  return { helper, calls, did: (command: string) => calls.filter((c) => c.command === command) };
}

function control(helper: Helper, confirmAnswer = true, ownPids: number[] = []) {
  const asked: string[] = [];
  const log: string[] = [];
  const indicator: boolean[] = [];
  const c = new ComputerControl(helper, {
    confirm: async (q) => (asked.push(q), confirmAnswer),
    log: (l) => log.push(l),
    indicator: (on) => indicator.push(on),
    open: async () => {},
    ownPids: () => ownPids,
  });
  return { c, asked, log, indicator };
}

const passwordField: UiElement = { role: "AXTextField", subrole: "AXSecureTextField", app: "Safari" };

describe("password fields", () => {
  it("are recognised by role, subrole or the helper's secure flag", () => {
    expect(isSecureField(passwordField)).toBe(true);
    expect(isSecureField({ role: "AXSecureTextField" })).toBe(true);
    expect(isSecureField({ role: "AXTextField", secure: true })).toBe(true);
    expect(isSecureField({ role: "AXTextField" })).toBe(false);
  });

  it("are never typed into", async () => {
    const h = fakeHelper({ focused: () => passwordField });
    const { c } = control(h.helper);
    expect(await c.type("hunter2")).toMatch(/password field/);
    expect(h.did("type")).toEqual([]);
  });

  it("are never pressed or focused from a tree ref", async () => {
    const h = fakeHelper({ describe: () => passwordField });
    const { c } = control(h.helper);
    expect(await c.focus("1/w/0")).toMatch(/password field/);
    expect(await c.press("1/w/0")).toMatch(/password field/);
    expect(h.did("focus")).toEqual([]);
    expect(h.did("press")).toEqual([]);
  });
});

describe("what Dan must confirm first", () => {
  const button = (title: string, app = "Mail"): UiElement => ({ role: "AXButton", title, app });

  it.each(["Send", "Buy Now", "Place order", "Delete", "Move to Bin", "Submit", "Confirm purchase", "Publish", "Pay"])("pressing %s", (title) => {
    expect(confirmationReason({ kind: "press", target: button(title) })).not.toBeNull();
  });

  it.each(["Bold", "Cancel", "Open", "Search", "Format"])("but not pressing a harmless %s", (title) => {
    expect(confirmationReason({ kind: "press", target: button(title, "TextEdit") })).toBeNull();
  });

  it("an icon inside a labelled Send button (its parent's label counts)", () => {
    expect(confirmationReason({ kind: "click", target: { role: "AXImage", parent: button("Send") } })).not.toBeNull();
  });

  it("anything at all in System Settings", () => {
    expect(confirmationReason({ kind: "click", target: { role: "AXCheckBox", title: "Wi-Fi", app: "System Settings" } })).toMatch(/system settings/);
    expect(confirmationReason({ kind: "focus", target: { app: "System Settings" } })).not.toBeNull();
  });

  it("send and delete shortcuts, Return in a form field or a terminal", () => {
    expect(confirmationReason({ kind: "key", combo: normaliseCombo("Cmd + Return") })).toMatch(/sends/);
    expect(confirmationReason({ kind: "key", combo: normaliseCombo("cmd+shift+d") })).toMatch(/sends/);
    expect(confirmationReason({ kind: "key", combo: "cmd+delete" })).toMatch(/deletes/);
    expect(confirmationReason({ kind: "key", combo: "return", focused: { role: "AXTextField", app: "Safari" } })).toMatch(/submit/);
    expect(confirmationReason({ kind: "key", combo: "return", focused: { role: "AXTextArea", app: "Terminal" } })).toMatch(/runs the command/);
    expect(confirmationReason({ kind: "type", text: "rm -rf build\n", focused: { role: "AXTextArea", app: "Terminal" } })).not.toBeNull();
  });

  it("but not everyday typing and shortcuts", () => {
    expect(confirmationReason({ kind: "key", combo: "cmd+b", focused: { role: "AXTextArea", app: "TextEdit" } })).toBeNull();
    expect(confirmationReason({ kind: "key", combo: "return", focused: { role: "AXTextArea", app: "TextEdit" } })).toBeNull();
    expect(confirmationReason({ kind: "key", combo: "return", focused: { role: "AXTextField", subrole: "AXSearchField", app: "Safari" } })).toBeNull();
    expect(confirmationReason({ kind: "type", text: "Hello there", focused: { role: "AXTextArea", app: "TextEdit" } })).toBeNull();
  });

  it("asks on a card, and does nothing if Dan says no", async () => {
    const h = fakeHelper({ describe: () => button("Send") });
    const { c, asked, log } = control(h.helper, false);
    expect(await c.press("9/w/0.1")).toMatch(/Dan said no/);
    expect(asked[0]).toMatch(/press "Send" in Mail/);
    expect(h.did("press")).toEqual([]);
    expect(log.join("\n")).toMatch(/declined/);
  });

  it("goes ahead, logged and with the indicator on, when he says yes", async () => {
    const h = fakeHelper({ describe: () => button("Send") });
    const { c, log, indicator } = control(h.helper, true);
    await c.press("9/w/0.1");
    expect(h.did("press")).toHaveLength(1);
    expect(log).toContain('press "Send" in Mail');
    expect(indicator).toContain(true);
  });
});

describe("stop", () => {
  it("halts typing part-way, and refuses more until Dan's next request", async () => {
    let c!: ComputerControl;
    const h = fakeHelper({
      focused: () => ({ role: "AXTextArea", app: "TextEdit" }),
      // Dan says stop while the second piece is being typed.
      type: () => (h.did("type").length === 2 ? c.stop() : undefined, { ok: true }),
    });
    ({ c } = control(h.helper));
    await expect(c.type("x".repeat(24 * 5))).rejects.toBeInstanceOf(StoppedError);
    expect(h.did("type")).toHaveLength(2);
    await expect(c.key("cmd+b")).rejects.toBeInstanceOf(StoppedError);
    expect(h.did("key")).toEqual([]);
    c.resume();
    await c.key("cmd+b");
    expect(h.did("key")).toHaveLength(1);
  });

  it("cancels a pending confirmation", async () => {
    let c!: ComputerControl;
    const h = fakeHelper({ describe: () => ({ role: "AXButton", title: "Send", app: "Mail" }) });
    c = new ComputerControl(h.helper, {
      confirm: async () => (c.stop(), true),
      log: () => {},
      indicator: () => {},
      open: async () => {},
    });
    await expect(c.press("1/w/0")).rejects.toBeInstanceOf(StoppedError);
    expect(h.did("press")).toEqual([]);
  });
});

describe("typing pieces", () => {
  it("splits long text and turns newlines into Return presses", () => {
    expect(typingChunks("ab\ncd", 1)).toEqual(["a", "b", "\n", "c", "d"]);
    expect(typingChunks("x".repeat(50)).every((p) => p.length <= 24)).toBe(true);
  });
});

describe("typing goes only where she focused", () => {
  const field = { role: "AXTextArea", app: "TextEdit" };

  it("sends the focused app's pid with every piece, so the helper can refuse another app", async () => {
    const h = fakeHelper({ describe: () => field, focused: () => field, type: () => ({ app: "TextEdit", landed: true }) });
    const { c } = control(h.helper);
    await c.focus("4321/w/0.1");
    expect(await c.type("hello\nthere")).toEqual({ typed: 11, app: "TextEdit" });
    expect(h.did("type").map((x) => x.input.pid)).toEqual([4321, 4321]);
    expect(h.did("key")[0]!.input).toEqual({ combo: "return", pid: 4321 });
  });

  it("stops and says why when the app in front isn't the one she focused", async () => {
    const h = fakeHelper({
      describe: () => field,
      focused: () => field,
      type: () => {
        throw Object.assign(new Error("Astra is in front, not TextEdit, so I didn't type."), { code: "wrong_target" });
      },
    });
    const { c } = control(h.helper);
    await c.focus("4321/w/0.1");
    const said = await c.type("one\ntwo");
    expect(said).toBe("Stopped after 0 of 7 characters: Astra is in front, not TextEdit, so I didn't type.");
    expect(h.did("type")).toHaveLength(1);
    expect(h.did("key")).toHaveLength(0);
  });

  it("reports text that was sent but never showed up", async () => {
    const h = fakeHelper({ focused: () => field, type: () => ({ app: "TextEdit", landed: false }) });
    const { c } = control(h.helper);
    expect(await c.type("lost words")).toMatch(/10 of them didn't show up/);
  });

  it("forgets the target after a click, which can put focus anywhere", async () => {
    const h = fakeHelper({ describe: () => field, focused: () => field, at: () => field });
    const { c } = control(h.helper);
    await c.focus("4321/w/0.1");
    await c.click(10, 10);
    await c.type("hi");
    expect(h.did("type")[0]!.input.pid).toBeUndefined();
  });
});

describe("after an approval card", () => {
  it("brings the app she focused back to the front before acting", async () => {
    // Anything in System Settings is confirmed first.
    const field = { role: "AXTextField", app: "System Settings" };
    const h = fakeHelper({ describe: () => field, focused: () => field, type: () => ({ landed: true }) });
    const { c, asked } = control(h.helper);
    await c.focus("777/w/0.1");
    asked.length = 0;
    await c.type("Thanks!");
    expect(asked).toHaveLength(1);
    const order = h.calls.map((x) => x.command).filter((x) => x === "activate" || x === "type");
    expect(order[0]).toBe("activate");
    expect(h.did("activate")[0]!.input).toEqual({ pid: 777 });
  });
});

describe("handing the keyboard back after a card", () => {
  const field = { role: "AXTextField", app: "Google Chrome" };

  it("re-activates the app she was working in when one of Astra's own windows is in front", async () => {
    // Chrome (16914) was in front for the first action; then Dan clicked a card, so Astra's orb (777) is.
    let front = 16914;
    const h = fakeHelper({ focused: () => field, front: () => ({ pid: front }), at: () => field, type: () => ({ landed: true }) });
    const { c } = control(h.helper, true, [777]);
    await c.click(10, 10);
    front = 777;
    await c.type("hello");
    expect(h.did("activate").map((x) => x.input)).toEqual([{ pid: 16914 }]);
    const order = h.calls.map((x) => x.command).filter((x) => x === "activate" || x === "type");
    expect(order).toEqual(["activate", "type"]);
  });

  it("leaves focus alone when the working app is already in front", async () => {
    const h = fakeHelper({ focused: () => field, front: () => ({ pid: 16914 }), at: () => field, type: () => ({ landed: true }) });
    const { c } = control(h.helper, true, [777]);
    await c.click(10, 10);
    await c.key("cmd+f");
    await c.type("hello");
    expect(h.did("activate")).toHaveLength(0);
  });
});
