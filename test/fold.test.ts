import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const orb = (f: string) => readFileSync(new URL(`../orb/${f}`, import.meta.url), "utf8");
// Every panel the orb can open, read from main.cjs itself, so a new panel without a fold button fails here too.
const panelFiles = [...orb("main.cjs").matchAll(/file: "([a-z-]+\.html)"/g)].map((m) => m[1]!);

describe("every panel has a fold (accordion) button in its header", () => {
  it("covers all eight panel kinds", () => {
    expect(panelFiles.sort()).toEqual(["brain.html", "git.html", "graph.html", "panel.html", "sessions.html", "tallyline.html", "terminal.html", "transcript.html"]);
  });

  for (const file of panelFiles) {
    it(`${file}: a labelled, keyboard-operable fold button beside close, wired by fold.js`, () => {
      const html = orb(file);
      const header = html.slice(html.indexOf('<header id="bar"'), html.indexOf("</header>"));
      const button = header.match(/<button id="fold"[^>]*>/)?.[0];
      expect(button, `${file} has lost its fold button`).toBeTruthy();
      expect(button).toMatch(/type="button"/);
      expect(button).toMatch(/aria-expanded="true"/);
      expect(button).toMatch(/aria-label="Fold the [^"]+"/);
      // It controls the panel's body, which exists.
      const controls = button!.match(/aria-controls="([^"]+)"/)?.[1];
      expect(html).toContain(`id="${controls}"`);
      // Beside close, and actually wired up.
      expect(header.indexOf('id="fold"')).toBeLessThan(header.indexOf('id="close"'));
      expect(html).toContain('<script src="fold.js"></script>');
    });
  }
});

describe("fold.js", () => {
  /** A minimal DOM: just enough elements for fold.js to wire up and toggle. */
  function load(withStatus: boolean) {
    const sent: any[] = [];
    let onMessage: (m: unknown) => void = () => {};
    const el = (id: string) => {
      const attrs: Record<string, string> = {};
      const listeners: Record<string, () => void> = {};
      const classes = new Set<string>();
      return {
        id,
        title: "",
        dataset: { panel: "terminal" },
        attrs,
        setAttribute: (k: string, v: string) => (attrs[k] = v),
        getAttribute: (k: string) => attrs[k] ?? null,
        addEventListener: (e: string, fn: () => void) => (listeners[e] = fn),
        click: () => listeners.click?.(),
        classList: { contains: (c: string) => classes.has(c), toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
        querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 92 }) }),
        getBoundingClientRect: () => ({ bottom: 92 }),
      };
    };
    const slab = el("slab");
    const fold = el("fold");
    const status = el("collapse");
    const byId: Record<string, unknown> = { fold, bar: el("bar"), ...(withStatus ? { collapse: status } : {}) };
    const window: any = { jarvis: { send: (m: unknown) => sent.push(m), onMessage: (fn: (m: unknown) => void) => (onMessage = fn) } };
    const document = { querySelector: (s: string) => (s === ".slab" ? slab : null), getElementById: (id: string) => byId[id] ?? null };
    vm.runInNewContext(orb("fold.js"), { window, document });
    return { slab, fold, status, sent, expand: () => onMessage({ type: "slab-expand" }) };
  }

  it("folds and unfolds, keeping aria-expanded and the label in step, and tells the orb", () => {
    const p = load(false);
    expect(p.fold.attrs["aria-expanded"]).toBe("true");
    p.fold.click();
    expect(p.slab.classList.contains("collapsed")).toBe(true);
    expect(p.fold.attrs["aria-expanded"]).toBe("false");
    expect(p.fold.attrs["aria-label"]).toBe("Unfold the terminal");
    expect(p.sent.at(-1)).toEqual({ type: "slab-collapse", collapsed: true, height: 102 });
    p.fold.click();
    expect(p.fold.attrs["aria-expanded"]).toBe("true");
    expect(p.sent.at(-1)).toMatchObject({ collapsed: false });
  });

  it("keeps the status line working as a second toggle, and unfolds from the dropdown", () => {
    const p = load(true);
    p.status.click();
    expect(p.slab.classList.contains("collapsed")).toBe(true);
    expect(p.fold.attrs["aria-expanded"]).toBe("false");
    expect(p.status.attrs["aria-expanded"]).toBe("false");
    p.expand();
    expect(p.slab.classList.contains("collapsed")).toBe(false);
    expect(p.fold.attrs["aria-expanded"]).toBe("true");
  });
});
