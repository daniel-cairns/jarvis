import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { heldDuringDemo } from "../src/demo.js";
import { Orb } from "../src/ui/orb.js";

/** An orb whose window process is a pair of pipes: what Astra sends is read back as JSON lines. */
function fakeOrb() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout }) as unknown as ChildProcess;
  const sent: { type: string }[] = [];
  stdin.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) sent.push(JSON.parse(line));
  });
  const orb = new Orb(child, { onTalk() {}, onStop() {}, onQuit() {} });
  const flush = () => new Promise((r) => setImmediate(r));
  return { orb, sent, flush };
}

describe("during the demo, real updates wait until it ends", () => {
  it("holds a real card, panel and caption, lets the demo's own through, then shows the held ones in order", async () => {
    const { orb, sent, flush } = fakeOrb();
    orb.hold(heldDuringDemo);
    orb.send({ type: "sessions", open: [], recent: [] });
    orb.trusted(() => orb.send({ type: "detail", title: "On your plate", html: "<p>demo</p>" }));
    void orb.ask("May I run npm test?", "npm test", new AbortController().signal);
    orb.send({ type: "caption", role: "jarvis", text: "Real news" });
    orb.send({ type: "state", state: "speaking" });
    await flush();
    expect(sent.map((m) => m.type)).toEqual(["detail", "state"]);
    orb.release();
    await flush();
    expect(sent.map((m) => m.type)).toEqual(["detail", "state", "sessions", "ask", "caption"]);
  });

  it("holds nothing once released", async () => {
    const { orb, sent, flush } = fakeOrb();
    orb.hold(heldDuringDemo);
    orb.release();
    orb.send({ type: "sessions", open: [], recent: [] });
    await flush();
    expect(sent.map((m) => m.type)).toEqual(["sessions"]);
  });
});
