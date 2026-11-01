import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { JarvisConfig } from "../config.js";
import { listNotes, readNote, saveNote, searchNotes } from "./brain.js";
import { launchCleanBrowser, openApp, openPath, realRunner, type Runner } from "./mac.js";

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

export function createJarvisServer(cfg: JarvisConfig, runner: Runner = realRunner) {
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
        "open_app",
        "Open a macOS application by name, e.g. 'Notes' or 'Safari'.",
        { name: z.string().min(1).max(80) },
        (args) => guarded(() => openApp(args.name, runner)),
      ),
      tool(
        "open_path",
        "Open a file or folder Jarvis made (inside the workspace or brain) with its default macOS app, e.g. an index.html in a browser window.",
        { path: z.string().min(1) },
        (args) => guarded(() => openPath(args.path, [cfg.workspaceDir, cfg.brainDir], runner)),
      ),
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
