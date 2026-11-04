/**
 * Demo mode: a hands-free tour of Astra's states and abilities, narrated by her, with made-up data so it's safe to
 * show anyone. Nothing reaches Claude (it costs nothing), and nothing real is opened, sent or changed. "Stop" or Esc
 * ends it, and whatever it switched on is put back.
 */
import type { ActivityGlyph } from "./activity.js";
import type { Answer } from "./permissions.js";
import type { TallylineSummary } from "./tools/tallyline.js";
import type { RepoState } from "./tools/git.js";
import type { TeardownGraph } from "./ui/graph.js";
import type { OrbState, ToOrb } from "./ui/orb.js";
import type { SessionRow, SessionsView } from "./ui/sessionsPanel.js";
import type { TermEntry } from "./ui/worklog.js";
import { godSlate } from "./ui/godSlate.js";
import type { QuestionAnswer, QuestionSpec } from "./voice/answers.js";

export type DemoDeps = {
  send(msg: ToOrb): void;
  /** Says a line (or captions it when she's silent); resolves when it has been said. */
  say(text: string, signal: AbortSignal): Promise<void>;
  /** Markdown to the detail panel's HTML. */
  render(markdown: string): string;
  question(spec: QuestionSpec, signal: AbortSignal): Promise<QuestionAnswer | null>;
  ask(spoken: string, detail: string, signal: AbortSignal): Promise<Answer | null>;
  /** Puts her mode, coffee and panels back as they were before the demo. */
  restore(): void;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
};

/**
 * Orb messages that can carry real data: while the demo runs, any of these it didn't send itself waits until it ends
 * (see Orb.hold). Her state, mode and window commands pass, since the demo drives and restores those itself.
 */
const HELD_TYPES = new Set<ToOrb["type"]>([
  "detail", "graph", "sessions", "tallyline", "terminal", "git", "git-diff-result", "transcript", "brain", "brain-note",
  "activity", "activity-reset", "transfer", "guard", "scribe", "ask", "question", "caption", "control", "recording",
  "god-sessions",
]);

export function heldDuringDemo(msg: ToOrb): boolean {
  return HELD_TYPES.has(msg.type);
}

/** How long a card waits for a click before the tour moves on. */
const CARD_MS = 7_000;

const GLYPHS: readonly [ActivityGlyph, string][] = [
  ["sun", "Thinking it through"],
  ["eye", "Reading the Temper session's latest reply"],
  ["ankh", "Writing notes/standup.md"],
  ["djed", "Running npm test"],
  ["water", "Searching the web for Kokoro voices"],
  ["reed", "Showing you a sit rep"],
];

const minutesAgo = (n: number) => Date.now() - n * 60_000;

function row(n: number, title: string, project: string, status: SessionRow["status"], now: string, astra = false): SessionRow {
  const state: SessionRow["state"] = status === "working" ? { phase: "tool", glyph: "ankh" } : status === "waiting" ? { phase: "waiting" } : { phase: "done" };
  const statusText = { working: "Working", waiting: "Waiting for you", idle: "Idle", done: "Done", failed: "Failed", stopped: "Stopped" }[status];
  // The rows are pretend, so none of their controls do anything.
  return { key: `demo-${n}`, ref: `demo-${n}`, title, project, where: astra ? "Astra" : "Desktop app", astra, status, statusText, state, at: minutesAgo(n * 7), now, reply: now, canOpen: false, canMessage: false, messageWhy: "This is the demo", canStop: false };
}

export const DEMO_SESSIONS: SessionsView = {
  open: [
    row(1, "Checkout redesign", "storefront", "working", "Editing the basket page"),
    row(2, "Release notes", "storefront", "waiting", "Ship 2.4 today or wait for QA?"),
    row(3, "Nightly tidy-up", "notes-app", "working", "Running the tests", true),
  ],
  recent: [row(4, "Fix the login bug", "storefront", "done", "Fixed and tested: the session cookie expired too early.")],
};

export const DEMO_PLATE = `## Waiting on your answer
- Ship 2.4 today or wait for QA? (Release notes)

## Running for you
- Nightly tidy-up (notes-app)

## For later
- Book the dentist
- Reply to Sam about Friday`;

export const DEMO_GRAPH: TeardownGraph = {
  nodes: [
    { id: "app", label: "Example Notes", group: "app", detail: "A made-up app for the demo." },
    { id: "editor", label: "Editor", group: "module" },
    { id: "sync", label: "Sync", group: "module" },
    { id: "vue", label: "Vue", group: "framework" },
    { id: "search", label: "Search", group: "feature" },
    { id: "sqlite", label: "SQLite", group: "data" },
    { id: "cloud", label: "Cloud storage", group: "service" },
  ],
  edges: [
    { source: "app", target: "editor", label: "contains" },
    { source: "app", target: "sync", label: "contains" },
    { source: "app", target: "search", label: "contains" },
    { source: "editor", target: "vue", label: "uses" },
    { source: "search", target: "sqlite", label: "stores in" },
    { source: "sync", target: "cloud", label: "calls", inferred: true },
  ],
};

const DEMO_TERMINAL: TermEntry[] = [
  { id: "demo-t1", source: "Astra", command: "npm test", cwd: "~/demo/storefront", output: "✓ 42 tests passed", status: "ok", at: new Date(minutesAgo(2)).toISOString() },
  { id: "demo-t2", source: "Astra", command: "npm run build", cwd: "~/demo/storefront", output: "Building…", status: "running", at: new Date().toISOString() },
];

const DEMO_GIT: RepoState[] = [
  {
    name: "storefront",
    root: "/demo/storefront",
    branch: "checkout-redesign",
    files: [
      { path: "src/pages/basket.vue", status: " M", added: 24, removed: 9 },
      { path: "src/components/PriceRow.vue", status: "??", added: 31, removed: 0 },
    ],
  },
];

const DEMO_TALLYLINE: TallylineSummary = {
  sprint: { id: 1, name: "Sprint 12", projectKey: "SHOP", endDate: null, total: 14, byStatus: { todo: 4, inProgress: 3, done: 7 } },
  todaySeconds: 3 * 3600 + 25 * 60,
  recent: [
    { key: "SHOP-118", summary: "Basket shows the wrong total", status: "In progress", category: "indeterminate", updatedAt: new Date(minutesAgo(30)).toISOString() },
    { key: "SHOP-117", summary: "Login cookie expires too early", status: "Done", category: "done", updatedAt: new Date(minutesAgo(90)).toISOString() },
  ],
};

const DEMO_QUESTION: QuestionSpec = {
  question: "Which colour should the new button be?",
  options: [{ label: "Gold" }, { label: "Teal" }, { label: "Leave it" }],
  multiSelect: false,
  allowOther: false,
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Runs the tour; resolves when it ends or `signal` aborts (it stops at the next step), and always restores. */
export async function runDemo(deps: DemoDeps, signal: AbortSignal): Promise<void> {
  const wait = (ms: number) => (deps.wait ?? sleep)(ms, signal);
  const say = async (text: string) => {
    if (!signal.aborted) await deps.say(text, signal);
  };
  const show = (msg: ToOrb) => {
    if (!signal.aborted) deps.send(msg);
  };
  const state = (s: OrbState) => show({ type: "state", state: s });
  const detail = (title: string, markdown: string) => show({ type: "detail", title, html: deps.render(markdown) });
  // Cards wait for a click, but not for ever, and not past a stop.
  const cardSignal = () => AbortSignal.any([signal, AbortSignal.timeout(CARD_MS)]);

  const steps: (() => Promise<void>)[] = [
    async () => {
      show({ type: "activity-reset" });
      await say("Welcome to my demo. Everything you'll see is made up, so it's safe to show anyone. Say stop whenever you like.");
    },
    // States
    async () => {
      await say("When you say my name, I listen.");
      state("listening");
      await wait(3_000);
    },
    async () => {
      await say("While I work, my ring spins and the sand runs.");
      state("thinking");
      await wait(3_500);
    },
    async () => {
      await say("When I talk, my wings open and the light follows my voice. And when I'm resting, I wait quietly and blink now and then.");
      state("idle");
      await wait(2_500);
    },
    // Activity glyphs
    async () => {
      await say("Each kind of work has its own glyph on my ring: thinking, reading, writing, running, the web, and showing you things.");
      state("thinking");
      for (const [glyph, text] of GLYPHS) {
        show({ type: "activity", text, glyph });
        await wait(1_200);
      }
    },
    async () => {
      await say("When a session sends or fetches something, Anubis stands guard over the transfer.");
      show({ type: "transfer", dir: "up" });
      await wait(2_500);
      show({ type: "transfer", dir: "down" });
      await wait(2_500);
      show({ type: "transfer", dir: null });
    },
    async () => {
      await say("Every web page I fetch is checked first. If one looks unsafe, I block it.");
      show({ type: "guard", state: "checking" });
      await wait(2_000);
      show({ type: "guard", state: "blocked" });
      await wait(2_500);
      show({ type: "guard", state: null });
    },
    async () => {
      await say("And once I know your voice, Anubis's eyes go red when someone else speaks, and I ignore them.");
      show({ type: "guard", state: "voice" });
      await wait(2_500);
      show({ type: "guard", state: null });
    },
    async () => {
      await say("When I research, Thoth rises behind me. He writes as I read, and glints when I've found it.");
      state("thinking");
      show({ type: "scribe", state: "researching" });
      await wait(4_500);
      show({ type: "scribe", state: "found" });
      await wait(1_400);
      show({ type: "scribe", state: null });
      state("idle");
    },
    async () => {
      await say("When I'm using your Mac's mouse and keyboard, this banner tells you so.");
      show({ type: "control", on: true });
      await wait(3_000);
      show({ type: "control", on: false });
    },
    // Talking
    async () => {
      state("idle");
      await say("I keep it short. You get the headline, and the rest waits on screen until you say more.");
      show({ type: "caption", role: "jarvis", text: "The rest of a long answer sits here, on screen, until you ask for it." });
      show({ type: "caption", role: "status", text: "Say “more” to hear the rest" });
      await wait(2_500);
    },
    // Cards
    async () => {
      await say("When I need a decision, I put it on a card. Answer by voice or by clicking.");
      const answer = await deps.question(DEMO_QUESTION, cardSignal());
      if (answer) await say(`${Array.isArray(answer) ? answer.join(", ") : answer}. Noted.`);
    },
    async () => {
      await say("And before anything risky, like running a command, I ask first.");
      await deps.ask("May I run npm test in storefront?", "npm test (in ~/demo/storefront)", cardSignal());
    },
    // EA
    async () => {
      await say("I keep track of what's on your plate: decisions waiting on you, work I'm running, and things for later.");
      detail("On your plate", DEMO_PLATE);
      await wait(5_000);
    },
    async () => {
      await say("I can run your Claude Code sessions. This panel shows each one live, and you can open, message or stop them from it.");
      show({ type: "sessions", ...DEMO_SESSIONS, owner: "user" });
      await wait(5_000);
    },
    async () => {
      await say("In god mode, I hand project work to your sessions and tell you when they're done.");
      show({ type: "mode", typeOnly: false, god: true });
      show({ type: "god-sessions", sessions: godSlate(DEMO_SESSIONS, []) });
      await wait(3_000);
    },
    async () => {
      await say("You can see every command I run, and what I've changed in your code.");
      show({ type: "terminal", entries: DEMO_TERMINAL, force: true, owner: "user" });
      await wait(2_500);
      show({ type: "git", repos: DEMO_GIT, force: true, owner: "user" });
      await wait(3_500);
    },
    async () => {
      await say("Tallyline, your work ledger, sits here too.");
      show({ type: "tallyline", summary: DEMO_TALLYLINE, owner: "user" });
      await wait(4_000);
    },
    async () => {
      await say("I can take an app apart and show you how it's built, as a map you can turn around.");
      show({ type: "graph", title: "Example Notes", graph: DEMO_GRAPH, owner: "user" });
      await wait(6_000);
    },
    async () => {
      await say("I tidy my windows so none of them overlap.");
      show({ type: "ui", action: "stack_windows" });
      await wait(3_000);
    },
    // Modes
    async () => {
      await say("I can record a meeting until you say stop recording, and save the transcript.");
      show({ type: "recording", on: true });
      show({ type: "state-label", text: "Recording 0:03" });
      await wait(3_000);
      show({ type: "recording", on: false });
    },
    async () => {
      await say("Coffee mode keeps your Mac awake.");
      show({ type: "coffee", on: true, until: Date.now() + 2 * 3600_000 });
      await wait(3_000);
    },
    async () => {
      await say("And in type only mode, my microphone is off and I stay silent.");
      show({ type: "mode", typeOnly: true, god: false });
      await wait(3_000);
    },
    async () => {
      await say("I can move around your screen, too.");
      show({ type: "ui", action: "move", position: "nudge_left" });
      await wait(1_500);
      show({ type: "ui", action: "move", position: "nudge_right" });
      await wait(1_500);
    },
    async () => {
      deps.restore();
      await say("That's my tour. Ask me anything.");
    },
  ];

  try {
    for (const step of steps) {
      if (signal.aborted) break;
      await step();
    }
  } finally {
    deps.send({ type: "activity-reset" });
    deps.send({ type: "ui", action: "close_panels" });
    deps.restore();
  }
}
