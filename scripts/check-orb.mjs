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
send({ type: "caption", role: "status", text: "Searching your brain…" });
send({ type: "ask", id: "1", spoken: "May I?", detail: "Smoke check." });
send({ type: "detail", title: "Check", html: "<h2>Detail</h2><p>ok</p>" });
send({
  type: "graph",
  title: "Check",
  graph: { nodes: [{ id: "a", label: "App", group: "app" }, { id: "b", label: "Lib", group: "framework" }], edges: [{ source: "a", target: "b" }] },
});
await wait(3000);
child.stdin.end();
await new Promise((r) => child.on("exit", r));

const errors = log.split("\n").filter((l) => /CONSOLE.*(Uncaught|Error)|Uncaught/i.test(l));
if (errors.length) {
  console.error(`Orb check failed:\n${errors.slice(0, 10).join("\n")}`);
  process.exit(1);
}
console.log("Orb check passed: no renderer errors in the orb, detail panel or map.");
