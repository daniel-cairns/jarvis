// Smoke-checks the orb app: opens it, drives every state plus the detail panel and map, and fails on any renderer
// console error. Unit tests can't see canvas/DOM errors; this caught nothing less than a blank orb once.
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
send({ type: "guard", state: null });
send({ type: "recording", on: false });
send({ type: "mode", typeOnly: false, god: false });
send({ type: "activity-reset" });
send({ type: "activity", text: "Thinking…" });
send({ type: "activity", text: "Reading a note: notes teardown" });
send({ type: "layout", top: true });
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
send({ type: "ui", action: "stack_windows" });
await wait(800);
send({ type: "ui", action: "close_panels" });
await wait(500);
child.stdin.end();
await new Promise((r) => child.on("exit", r));

const errors = log.split("\n").filter((l) => /CONSOLE.*(Uncaught|Error)|Uncaught/i.test(l));
if (errors.length) {
  console.error(`Orb check failed:\n${errors.slice(0, 10).join("\n")}`);
  process.exit(1);
}
console.log("Orb check passed: no renderer errors in the orb, detail panel, map, brain browser, terminal or git panel.");
