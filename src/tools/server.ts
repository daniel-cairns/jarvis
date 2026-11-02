import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { JarvisConfig } from "../config.js";
import { listNotes, readNote, saveNote, searchNotes } from "./brain.js";
import { launchCleanBrowser, openApp, openPath, realRunner, type Runner } from "./mac.js";
import { serveApp } from "./serve.js";
import { checkGraph, graphShape, type TeardownGraph } from "../ui/graph.js";
import type { QuestionAnswer, QuestionSpec } from "../voice/answers.js";
import { POSITIONS, UI_ACTIONS, type Position, type UiAction } from "../ui/control.js";
import type { ComputerControl } from "../control/computer.js";
import type { CoffeeMode } from "../power/coffee.js";

export const SERVER_NAME = "jarvis";

type ToolText = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolText => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

/** Tool failures go back to the model as a readable error, not a crashed turn. */
async function guarded(fn: () => Promise<unknown>): Promise<ToolText> {
  try {
    return ok(await fn());
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

/** Shows markdown in the detail panel; returns where it ended up, for the model to know. */
export type ShowDetail = (title: string, markdown: string) => string;
export type ShowGraph = (title: string, graph: TeardownGraph) => string;
export type AskQuestion = (spec: QuestionSpec) => Promise<QuestionAnswer | null>;
export type UiControl = (action: UiAction, level?: number, position?: Position) => string | Promise<string>;

/** Astra's other abilities, provided by whoever hosts her (the CLI with its orb); each is optional. */
export type ServerHooks = {
  showDetail?: ShowDetail;
  showGraph?: ShowGraph;
  askQuestion?: AskQuestion;
  uiControl?: UiControl;
  sessions?: SessionTools;
  windows?: WindowTools;
  computer?: ComputerControl;
  coffee?: CoffeeMode;
};

/** Bringing back windows she showed recently; see src/index.ts. */
export type WindowTools = {
  /** No `which` (or "list"): what's been shown. "all": everything from her last request. Otherwise the best match. */
  show(which?: string): Promise<string>;
};

/** Working your other Claude Code sessions; see src/index.ts for the implementation. */
export type SessionTools = {
  list(project?: string, includeAstra?: boolean): Promise<unknown>;
  read(session: string): Promise<unknown>;
  send(session: string, prompt: string): Promise<string>;
  start(project: string, prompt: string, where: "background" | "app"): Promise<string>;
  open(session: string): Promise<string>;
  stop(job: string): string;
};

export function createJarvisServer(cfg: JarvisConfig, runner: Runner = realRunner, hooks: ServerHooks = {}) {
  const { showDetail, showGraph, askQuestion, uiControl, sessions, windows, coffee } = hooks;
  const noSessions = "Session control isn't available here.";
  return createSdkMcpServer({
    name: SERVER_NAME,
    version: "0.1.0",
    tools: [
      tool(
        "brain_save",
        "Save a markdown note to the second brain. Use folder 'teardowns' for REA reports, 'notes' otherwise. Returns the saved path.",
        {
          title: z.string().min(1).max(200),
          body: z.string().min(1),
          folder: z.string().optional(),
          tags: z.array(z.string()).max(10).optional(),
        },
        (args) => guarded(() => saveNote(cfg.brainDir, args)),
      ),
      tool(
        "brain_search",
        "Search the second brain by keywords. Returns matching note paths, titles and snippets.",
        { query: z.string().min(1), limit: z.number().int().min(1).max(25).optional() },
        (args) => guarded(() => searchNotes(cfg.brainDir, args.query, args.limit)),
      ),
      tool(
        "brain_list",
        "List the most recently changed notes, optionally inside one folder such as 'teardowns'.",
        { folder: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
        (args) => guarded(() => listNotes(cfg.brainDir, args.folder, args.limit)),
      ),
      tool(
        "brain_read",
        "Read a note. Pass section to get one heading's text, which is how to read a long report aloud one section at a time. The result always lists the note's section headings.",
        { path: z.string().min(1), section: z.string().optional() },
        (args) => guarded(() => readNote(cfg.brainDir, args.path, args.section)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "show_detail",
        "Show the user detail on screen in your HUD panel: lists, tables, steps, code, a report section, anything too long or visual to say aloud. Markdown. Speak a short summary alongside it.",
        { title: z.string().min(1).max(120), markdown: z.string().min(1).max(200_000) },
        (args) => guarded(async () => (showDetail ? showDetail(args.title, args.markdown) : "No screen is attached; say it instead.")),
      ),
      tool(
        "ask_user",
        "Ask the user one or more questions and wait for the answers: a card on screen with option buttons, answerable by voice or click. Use it whenever you need a decision or preferences (several questions in a row for an interview). Keep options short (2 to 5), each a few words.",
        {
          questions: z
            .array(
              z.object({
                question: z.string().min(1).max(300),
                options: z.array(z.object({ label: z.string().min(1).max(60), description: z.string().max(200).optional() })).max(8).optional(),
                multiSelect: z.boolean().optional(),
                allowOther: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(8),
        },
        (args) =>
          guarded(async () => {
            if (!askQuestion) return "No way to ask on screen here; ask in your reply instead.";
            const answers: { question: string; answer: QuestionAnswer | "(no answer)" }[] = [];
            for (const q of args.questions) {
              const spec: QuestionSpec = {
                question: q.question,
                options: q.options ?? [],
                multiSelect: q.multiSelect ?? false,
                allowOther: q.allowOther ?? true,
              };
              const answer = await askQuestion(spec);
              answers.push({ question: q.question, answer: answer ?? "(no answer)" });
              if (answer === null) break;
            }
            return answers;
          }),
      ),
      tool(
        "sessions_list",
        "List the user's recent Claude Code sessions (desktop app and terminal) with title, project, status (working / waiting for the user / idle), latest reply, and any sessions you're running in the background. Optionally filter by project name.",
        { project: z.string().max(80).optional(), include_astra: z.boolean().optional() },
        (args) => guarded(async () => (sessions ? sessions.list(args.project, args.include_astra) : noSessions)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "session_read",
        "Read one Claude Code session's latest reply and last prompt. Pass its id, or a title or project fragment.",
        { session: z.string().min(1).max(120) },
        (args) => guarded(async () => (sessions ? sessions.read(args.session) : noSessions)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "session_send",
        "Send a prompt to an existing Claude Code session (by id, title or project). It runs in the background, resumed from that session, only if the session is idle (not mid-turn). Its approval requests come to the user through you; you'll be told when it finishes.",
        { session: z.string().min(1).max(120), prompt: z.string().min(1).max(8000) },
        (args) => guarded(async () => (sessions ? sessions.send(args.session, args.prompt) : noSessions)),
      ),
      tool(
        "session_start",
        "Start a new Claude Code session in one of the user's projects (a folder name like 'gymclaw', or a path). where='background' runs it for the user and reports back; where='app' opens it in the Claude app and sends the prompt straight away, so it runs there and the user can watch it live (its approvals then appear as cards in the app, not through you). Prefer 'app' when the user wants to see the work.",
        { project: z.string().min(1).max(200), prompt: z.string().min(1).max(8000), where: z.enum(["background", "app"]) },
        (args) => guarded(async () => (sessions ? sessions.start(args.project, args.prompt, args.where) : noSessions)),
      ),
      tool(
        "session_open",
        "Open a Claude Code session in the Claude app (by id, title, project, or a background run like 's1').",
        { session: z.string().min(1).max(120) },
        (args) => guarded(async () => (sessions ? sessions.open(args.session) : noSessions)),
      ),
      tool(
        "session_stop",
        "Stop a background session run you started (its handle, like 's1').",
        { job: z.string().min(1).max(20) },
        (args) => guarded(async () => (sessions ? sessions.stop(args.job) : noSessions)),
      ),
      tool(
        "show_window",
        "Your panels close by themselves when you finish a request, unless you showed them on purpose. Use this when the user asks to see one again: which='list' to see what you've shown recently, 'all' for everything from your last request, or a description ('the sit rep', 'terminal', 'gymclaw map', 'the teardown').",
        { which: z.string().max(200).optional() },
        (args) => guarded(async () => (windows ? windows.show(args.which) : "No screen is attached.")),
      ),
      tool(
        "ui_control",
        "Work your own interface when the user asks: minimise (you fold away into the menu bar) or show (you unfold back), stop speaking/working, close your panels, collapse or expand your thinking window, show your terminal (show_terminal) or git changes (show_git) panels, re-open the last detail panel or map, open the brain browser (all notes and teardowns), or change your speaking volume (volume_up, volume_down, or set_volume with level 0-100), or move yourself on screen (move with a position: a spot like top_left or centre, or a nudge_left/right/up/down), or start long transcript mode (start_transcript: once this reply ends you record everything said until the user says 'stop recording', then save it to the brain under transcripts), or switch to type-only mode (type_only: microphone off and you stay silent, replies on screen only) or back (voice_mode), or give a sit rep of every session (sitrep: shows a panel and returns the summary to tell the user), or turn god mode on or off (god_mode_on / god_mode_off: you command the user's sessions and announce when they finish), or tidy up your panels (stack_windows: they're laid out automatically so none overlap; this also brings back into the layout any the user dragged or resized by hand), or pick up your previous conversation after a restart (continue_session: only when the user asks; it resumes once this reply ends), or restart yourself (restart: you quit and start again with your latest code, once this reply and any background sessions you're running have finished). Use this rather than shell commands to move your window.",
        { action: z.enum(UI_ACTIONS), level: z.number().int().min(0).max(100).optional(), position: z.enum(POSITIONS).optional() },
        (args) => guarded(async () => (uiControl ? uiControl(args.action, args.level, args.position) : "No screen is attached.")),
      ),
      tool(
        "coffee_mode",
        "Coffee mode keeps the Mac awake (no sleep) while it's on. Use when the user says coffee mode (on), coffee mode off / stop coffee mode (off), optionally for a time ('coffee mode for two hours': minutes 120), or asks whether it's on (status). It carries on through a restart; quitting you ends it.",
        { action: z.enum(["on", "off", "status"]), minutes: z.number().int().min(1).max(24 * 60).optional() },
        (args) =>
          guarded(async () => {
            if (!coffee) return "Coffee mode isn't available here.";
            if (args.action === "on") return coffee.start(args.minutes);
            if (args.action === "off") return coffee.stop();
            return coffee.status();
          }),
      ),
      tool(
        "show_graph",
        "Show an interactive 3D map of a teardown in your HUD: nodes are the app/site, its modules, frameworks, features, data stores and outside services; edges are how they connect (label them: uses, contains, stores in, calls). Ground it in REA evidence; set inferred: true on links you deduced rather than observed; put the evidence in each node's detail.",
        { title: z.string().min(1).max(120), ...graphShape },
        (args) =>
          guarded(async () => {
            const graph = checkGraph({ nodes: args.nodes, edges: args.edges });
            return showGraph ? showGraph(args.title, graph) : "No screen is attached; describe the structure instead.";
          }),
      ),
      tool(
        "open_app",
        "Open a macOS application by name, e.g. 'Notes' or 'Safari'.",
        { name: z.string().min(1).max(80) },
        (args) => guarded(() => openApp(args.name, runner)),
      ),
      tool(
        "open_path",
        "Open a file or folder Astra made (inside the workspace or brain) with its default macOS app, e.g. an index.html in a browser window.",
        { path: z.string().min(1) },
        (args) => guarded(() => openPath(args.path, [cfg.workspaceDir, cfg.brainDir], runner)),
      ),
      tool(
        "serve_app",
        "Serve a built web app from the workspace on 127.0.0.1 and open it in the user's browser. Pass the folder that holds index.html (for Nuxt: run `npx nuxi generate`, then pass .output/public). Returns the URL.",
        { path: z.string().min(1) },
        (args) =>
          guarded(async () => {
            const url = await serveApp(args.path, cfg.workspaceDir);
            await runner.run("open", [url]);
            return `Serving at ${url} and opened it in the browser.`;
          }),
      ),
      ...(hooks.computer ? computerTools(hooks.computer) : []),
      tool(
        "launch_clean_browser",
        "Start a fresh Chrome profile on a DevTools port and load a URL, so REA's browser tools can observe it. Returns the cdp_endpoint to pass to REA's browser tools.",
        { url: z.string().min(1) },
        (args) =>
          guarded(() => launchCleanBrowser(args.url, { chromeBin: cfg.chromeBin, port: cfg.chromeDebugPort }, runner)),
      ),
    ],
  });
}

/**
 * Operating Mac apps (src/control/): read the Accessibility tree first, act on what it returns by ref, and fall
 * back to screenshots and coordinates only when the tree doesn't show what's needed.
 */
function computerTools(computer: ComputerControl) {
  const point = { x: z.number(), y: z.number() };
  return [
    tool("computer_permissions", "Check that Astra may control the Mac (Accessibility) and see the screen (Screen Recording). If either is missing, opens the right System Settings pane and says what Dan needs to turn on.", {}, () =>
      guarded(async () => (await computer.permissions("both", true)).message),
    ),
    tool("computer_windows", "List on-screen windows: app, pid, windowId, title, frame.", {}, () => guarded(() => computer.windows())),
    tool(
      "computer_read_ui",
      "Read an app's UI as an Accessibility tree (roles, titles, labels, values, frames, actions), each element with a ref to act on. Defaults to the frontmost app's focused window. Prefer this to screenshots. Password fields show as secure, without their value. When two copies of an app run (Dan's own Chrome and the clean one), pass pid (from computer_windows or launch_clean_browser); by name it refuses to guess.",
      { app: z.string().optional(), pid: z.number().int().optional(), scope: z.enum(["window", "app"]).optional(), depth: z.number().int().min(1).max(40).optional(), max: z.number().int().min(10).max(2000).optional() },
      (a) => guarded(() => computer.readUi(a)),
    ),
    tool(
      "computer_screenshot",
      "Screenshot the whole screen, a region (points), or one window (windowId from computer_windows). Use when the UI tree doesn't show what you need.",
      { x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), windowId: z.number().int().optional() },
      async (a) => {
        try {
          const region = a.x !== undefined && a.y !== undefined && a.width && a.height ? { x: a.x, y: a.y, width: a.width, height: a.height } : undefined;
          const shot = await computer.screenshot({ region, windowId: a.windowId });
          if (typeof shot === "string") return ok(shot);
          return { content: [{ type: "image" as const, data: shot.png.toString("base64"), mimeType: "image/png" }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
        }
      },
    ),
    tool("computer_press", "Press (click) an element by its ref from computer_read_ui. Asks Dan first if it looks like it sends, buys, deletes or submits.", { ref: z.string() }, (a) =>
      guarded(() => computer.press(a.ref)),
    ),
    tool("computer_click", "Click at screen coordinates (points, top-left origin). count 2 for a double-click; right for a right-click. Prefer computer_press with a ref.", { ...point, count: z.number().int().min(1).max(3).optional(), right: z.boolean().optional() }, (a) =>
      guarded(() => computer.click(a.x, a.y, a.count, a.right)),
    ),
    tool("computer_focus", "Move keyboard focus to an element by its ref (e.g. a text field before typing).", { ref: z.string() }, (a) => guarded(() => computer.focus(a.ref))),
    tool("computer_type", "Type text into the focused element. Never works in password fields. A newline presses Return.", { text: z.string().min(1).max(5000) }, (a) =>
      guarded(() => computer.type(a.text)),
    ),
    tool("computer_key", 'Press a key or combo, e.g. "cmd+a", "cmd+b", "return", "shift+tab", "escape", "down".', { combo: z.string().min(1) }, (a) =>
      guarded(() => computer.key(a.combo)),
    ),
    tool("computer_scroll", "Scroll by lines: negative dy scrolls down. Optionally at a point.", { dy: z.number().int(), dx: z.number().int().optional(), x: z.number().optional(), y: z.number().optional() }, (a) =>
      guarded(() => computer.scroll(a.dy, a.dx, a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : undefined)),
    ),
    tool(
      "computer_open_app",
      "Open an app (launching it if needed) and bring it to the front. Pass pid to bring one exact copy forward when several are running.",
      { name: z.string().min(1), pid: z.number().int().optional() },
      (a) => guarded(() => computer.openApp(a.name, a.pid)),
    ),
  ];
}
