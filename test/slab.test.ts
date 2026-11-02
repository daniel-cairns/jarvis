import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("../orb/slab.js", import.meta.url), "utf8");

/** A minimal element: classes, attributes, text and click listeners. */
function element(classes: string[] = [], text = "") {
  const listeners: Record<string, (() => void)[]> = {};
  const set = new Set(classes);
  const attrs: Record<string, string> = {};
  return {
    textContent: text,
    title: "",
    classList: {
      contains: (c: string) => set.has(c),
      toggle: (c: string, on: boolean) => (on ? set.add(c) : set.delete(c)),
    },
    setAttribute: (k: string, v: string) => (attrs[k] = v),
    getAttribute: (k: string) => attrs[k],
    addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
    getBoundingClientRect: () => ({ bottom: 90 }),
    click: () => listeners.click?.forEach((fn) => fn()),
  };
}

/** Runs slab.js against a fake page whose fold control is `collapse`. */
function load(collapse: ReturnType<typeof element>) {
  const slab = element(["slab"]);
  const shelf = element();
  const close = element();
  const sent: unknown[] = [];
  let onMessage: (m: { type: string }) => void = () => {};
  const window = {
    jarvis: { send: (m: unknown) => sent.push(m), onMessage: (fn: typeof onMessage) => (onMessage = fn) },
    addEventListener() {},
  } as Record<string, unknown>;
  const document = {
    getElementById: (id: string) => ({ collapse, close })[id],
    querySelector: (sel: string) => ({ ".slab": slab, ".shelf": shelf })[sel],
  };
  vm.runInNewContext(SOURCE, { window, document });
  return { slab, sent, message: (m: { type: string }) => onMessage(m) };
}

describe("folding a work panel", () => {
  it("lets the transcript's status line fold and unfold it, keeping its text", () => {
    const line = element(["meta", "fold-line"], "RUN | WORKING");
    const { slab, sent } = load(line);
    line.click();
    expect(slab.classList.contains("collapsed")).toBe(true);
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(line.textContent).toBe("RUN | WORKING");
    expect(sent.at(-1)).toEqual({ type: "slab-collapse", collapsed: true, height: 100 });
    line.click();
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(sent.at(-1)).toMatchObject({ type: "slab-collapse", collapsed: false });
  });

  it("unfolds when the orb's panel menu asks", () => {
    const line = element(["meta", "fold-line"], "RUN | IDLE");
    const { slab, sent, message } = load(line);
    line.click();
    message({ type: "slab-expand" });
    expect(slab.classList.contains("collapsed")).toBe(false);
    expect(sent.at(-1)).toMatchObject({ type: "slab-collapse", collapsed: false });
  });

  it("still shows an arrow on the round fold button of the other panels", () => {
    const button = element([], "▾");
    load(button).slab;
    button.click();
    expect(button.textContent).toBe("▸");
  });
});
