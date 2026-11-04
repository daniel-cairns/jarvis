// Smoke-checks the orb app: opens it, plays every state, glyph and figure (Anubis, Thoth, god mode, the beam) plus every
// panel, and fails on any renderer console error or window-process error. Unit tests can't see canvas/DOM errors; this caught nothing less than a blank orb once.
// Run with `npm run check:orb` (it shows the windows for a few seconds).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, ["orb/main.cjs"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
});
let log = "";
child.stderr.on("data", (d) => (log += d));
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await wait(1500);
for (const state of ["idle", "listening", "thinking", "speaking"]) {
  send({ type: "state", state });
  if (state === "speaking") send({ type: "utterance", text: "Checking.", envelope: [0.2, 0.8, 0.5, 0.1], frameMs: 50 });
  await wait(400);
}
send({ type: "recording", on: true });
send({ type: "state-label", text: "Recording 00:05" });
send({ type: "mode", typeOnly: true, god: true });
send({ type: "caption", role: "you", text: "sit rep" });
send({ type: "caption", role: "jarvis", text: "All quiet: nothing is working or waiting on you." });
send({ type: "state", state: "thinking" });
send({ type: "transfer", dir: process.env.ORB_CHECK_TRANSFER ?? "up" });
await wait(Number(process.env.ORB_CHECK_HOLD_MS ?? 600));
send({ type: "transfer", dir: "down" });
await wait(300);
send({ type: "transfer", dir: null });
send({ type: "guard", state: "checking" });
await wait(300);
send({ type: "guard", state: "blocked" });
await wait(300);
// A refused voice: Anubis with red eyes.
send({ type: "guard", state: "voice" });
await wait(300);
send({ type: "guard", state: null });
// Every activity glyph on the ring.
for (const glyph of ["sun", "eye", "ankh", "djed", "water", "reed"]) {
  send({ type: "activity", text: `Glyph: ${glyph}`, glyph });
  await wait(150);
}
// Thoth researching, his glint, and stepping back while Anubis guards.
send({ type: "scribe", state: "researching" });
await wait(700);
send({ type: "guard", state: "checking" });
await wait(400);
send({ type: "guard", state: null });
await wait(300);
send({ type: "scribe", state: "found" });
await wait(500);
send({ type: "scribe", state: null });
// God mode's ring and gold aura, idle and working; coffee; the volume arc.
send({ type: "mode", typeOnly: false, god: true });
send({ type: "state", state: "idle" });
await wait(300);
send({ type: "state", state: "thinking" });
await wait(300);
send({ type: "coffee", on: true, until: Date.now() + 3_600_000 });
send({ type: "volume-level", level: 0.6 });
await wait(300);
send({ type: "coffee", on: false, until: null });
// God mode commanding sessions: the glyph ring, a satellite each, the Eye on her wing; then a session newly waiting on
// Dan pops the slate out, and with nobody pointing at it, it folds away after its six seconds.
const at = Date.now();
const entry = (key, glyph, meaning, satellite, needs = "Nothing") => ({
  key, ref: `ref-${key}`, title: `Session ${key}`, status: satellite ?? "done", glyph, meaning, summary: `Doing ${key}`,
  lastAction: "Edited a file", needs, at, onSlate: true, ...(satellite ? { satellite } : {}),
});
const commanded = [
  entry("a", "working", "Working", "working"),
  entry("b", "idle", "Idle", "idle"),
  entry("c", "background", "Background run", "working"),
  { ...entry("d", "done", "Done"), ref: undefined },
];
send({ type: "god-sessions", sessions: commanded });
await wait(800);
send({ type: "god-sessions", sessions: [entry("e", "waiting", "Waiting on you", "waiting", "Your next instruction"), ...commanded] });
await wait(1500);
// Untouched, it folds after 6 s, then gives the window its room back.
await wait(6200);
send({ type: "god-sessions", sessions: [] });
send({ type: "mode", typeOnly: false, god: false });
// Controlling the Mac: its overlay, and her ether beam to the app's window.
send({ type: "control", on: true });
await wait(600);
send({ type: "beam", target: { x: 80, y: 120, width: 640, height: 420 } });
await wait(900);
send({ type: "beam", target: null });
send({ type: "control", on: false });
send({ type: "recording", on: false });
send({ type: "mode", typeOnly: false, god: false });
send({ type: "activity-reset" });
send({ type: "activity", text: "Thinking…" });
send({ type: "activity", text: "Reading a note: notes teardown" });
send({ type: "layout", top: true, split: true });
send({ type: "question", id: "q1", question: "Which service?", options: [{ label: "Spotify" }, { label: "Apple Music" }], multiSelect: true, allowOther: true });
await wait(300);
send({ type: "answered", id: "q1" });
send({ type: "layout", top: false });
send({
  type: "brain",
  notes: [{ path: "teardowns/a.md", title: "A teardown", modified: new Date().toISOString(), folder: "teardowns", snippet: "x", hasMap: true }],
});
await wait(1200);
send({ type: "brain-note", path: "teardowns/a.md", title: "A teardown", html: "<h2>Summary</h2><p>ok</p>", hasMap: true });
send({ type: "ask", id: "1", spoken: "May I?", detail: "Smoke check." });
send({ type: "detail", title: "Check", html: "<h2>Detail</h2><p>ok</p>" });
send({
  type: "graph",
  title: "Check",
  graph: { nodes: [{ id: "a", label: "App", group: "app" }, { id: "b", label: "Lib", group: "framework" }], edges: [{ source: "a", target: "b" }] },
});
send({
  type: "terminal",
  force: true,
  entries: [{ id: "1", source: "Astra", command: "npm test", cwd: "/w/app", output: "12 passed", status: "ok", at: new Date().toISOString() }],
});
send({
  type: "git",
  force: true,
  repos: [{ name: "app", root: "/w/app", branch: "main", files: [{ path: "src/a.ts", status: " M", added: 3, removed: 1 }] }],
});
await wait(1500);
send({ type: "git-diff-result", root: "/w/app", path: "src/a.ts", diff: "@@ -1 +1 @@\n-old\n+new" });
await wait(3000);
send({
  type: "transcript",
  job: { id: "s1", label: "super-potato", status: "running" },
  lines: [
    { kind: "prompt", text: "Continue Satsuma." },
    { kind: "text", text: "Picking up after 167ced1." },
    { kind: "tool", text: "Running a command: npm test" },
    { kind: "end", text: "Finished." },
  ],
});
await wait(800);
send({ type: "panels", panels: [{ kind: "transcript", state: "collapsed" }, { kind: "git", state: "closed" }] });
send({ type: "collapse", collapsed: true });
send({ type: "collapse", collapsed: false });
send({ type: "request-done" });
send({ type: "ui", action: "stack_windows" });
await wait(800);
send({ type: "ui", action: "close_panels" });
await wait(500);
child.stdin.end();
await new Promise((r) => child.on("exit", r));

// Renderer console errors, and errors in the window process itself (a crash dialog there is just as broken).
const errors = log.split("\n").filter((l) => /CONSOLE.*(Uncaught|Error)|Uncaught|TypeError|ReferenceError/i.test(l));
// The slate logs when it opens and when it has folded (god.js): both must have happened.
for (const [mark, what] of [["[slate] open", "pop out"], ["[slate] folded", "fold away"]]) {
  if (!log.includes(mark)) errors.push(`God mode's slate didn't ${what} (no "${mark}" in the orb's log)`);
}
if (errors.length) {
  console.error(`Orb check failed:\n${errors.slice(0, 10).join("\n")}`);
  process.exit(1);
}
console.log(
  "Orb check passed: every state, glyph and figure (Anubis, Thoth, god mode with its ring, satellites, Eye and slate, the ether beam) and every panel played with no errors.",
);
