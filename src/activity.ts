/** Turns a tool name into a short, plain-English progress line for the orb ("Searching your brain…"). */

const OWN: Record<string, string> = {
  brain_search: "Searching your brain",
  brain_list: "Looking through your notes",
  brain_read: "Reading a note",
  brain_save: "Saving to your brain",
  show_detail: "Putting it on screen",
  open_app: "Opening an app",
  open_path: "Opening it",
  serve_app: "Starting the app",
  launch_clean_browser: "Opening a clean browser",
  ask_user: "Asking you",
  ui_control: "Adjusting the display",
  sessions_list: "Checking your sessions",
  session_read: "Reading a session",
  session_send: "Sending to a session",
  session_start: "Starting a session",
  session_open: "Opening a session in the app",
  session_stop: "Stopping a session",
};

const BUILT_IN: Record<string, string> = {
  Read: "Reading files",
  Glob: "Looking through files",
  Grep: "Searching files",
  Write: "Writing code",
  Edit: "Editing code",
  MultiEdit: "Editing code",
  NotebookEdit: "Editing a notebook",
  Bash: "Running a command",
  WebSearch: "Searching the web",
  WebFetch: "Reading a web page",
  TodoWrite: "Planning the steps",
  ToolSearch: "Finding the right tool",
  Task: "Handing part of it to a helper",
  Agent: "Handing part of it to a helper",
};

/** The glyph from her ring that stands for each kind of work. */
export type ActivityGlyph = "sun" | "eye" | "ankh" | "djed" | "water" | "reed";

/**
 * Which glyph a tool shows: eye for reading and inspecting, ankh for writing and building, djed for running
 * commands, water for the web and opening things, reed for asking and showing, sun for thinking.
 */
export function activityGlyph(toolName: string): ActivityGlyph {
  const tool = toolName.replace(/^mcp__[^_]+__/, "");
  if (toolName.startsWith("mcp__rea__")) return "eye";
  if (["Read", "Grep", "Glob", "brain_read", "brain_search", "brain_list", "WebFetch", "sessions_list", "session_read"].includes(tool)) return "eye";
  if (["session_send", "session_start"].includes(tool)) return "ankh";
  if (["session_open"].includes(tool)) return "water";
  if (["session_stop"].includes(tool)) return "djed";
  if (["Write", "Edit", "MultiEdit", "NotebookEdit", "brain_save", "serve_app"].includes(tool)) return "ankh";
  if (["Bash", "TodoWrite", "Task", "Agent"].includes(tool)) return "djed";
  if (["WebSearch", "launch_clean_browser", "open_app", "open_path"].includes(tool)) return "water";
  if (["ask_user", "show_detail", "show_graph", "ui_control"].includes(tool)) return "reed";
  return "sun";
}

/** A short, safe-to-show detail from a tool's input: a file name, a search, a site, a command's first words. */
export function activityDetail(toolName: string, input: Record<string, unknown> = {}): string {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const base = (p: string) => p.split("/").filter(Boolean).at(-1) ?? "";
  const host = (u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return "";
    }
  };
  const clip = (t: string, n = 48) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const tool = toolName.replace(/^mcp__[^_]+__/, "");
  if (toolName === "Bash") return clip(str("command").split("\n")[0]!);
  if (["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) return base(str("file_path") || str("notebook_path"));
  if (toolName === "Glob" || toolName === "Grep") return clip(str("pattern"));
  if (toolName === "WebSearch") return clip(str("query"));
  if (toolName === "WebFetch") return host(str("url"));
  if (tool === "brain_search") return clip(str("query"));
  if (tool === "brain_read") return base(str("path")).replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
  if (tool === "brain_save" || tool === "show_detail" || tool === "show_graph") return clip(str("title"));
  if (tool === "serve_app" || tool === "open_path") return base(str("path"));
  if (tool === "open_app") return str("name");
  if (["session_read", "session_send", "session_open"].includes(tool)) return clip(str("session"));
  if (tool === "session_start") return clip(str("project"));
  if (tool === "sessions_list") return clip(str("project"));
  if (tool === "launch_clean_browser") return host(str("url"));
  if (toolName.startsWith("mcp__rea__")) return base(str("path")) || host(str("url")) || "";
  return "";
}

export function describeActivity(toolName: string, input?: Record<string, unknown>): string {
  const detail = input ? activityDetail(toolName, input) : "";
  const mcp = toolName.match(/^mcp__([^_]+)__(.+)$/);
  let what: string;
  if (mcp) {
    const [, server, tool] = mcp;
    if (server === "jarvis") what = OWN[tool!] ?? "Working";
    else if (server === "rea") what = `Inspecting with REA: ${tool!.replace(/_/g, " ")}`;
    else what = `Using ${server!.replace(/^plugin_[^_]+_/, "").replace(/[-_]/g, " ")}`;
  } else {
    what = BUILT_IN[toolName] ?? "Working";
  }
  return detail ? `${what}: ${detail}` : `${what}…`;
}

export type Transfer = "up" | "down";

// Shell commands that send data off the machine, or bring it in. Checked in order: "up" wins for mixed pipelines.
const UPLOAD_COMMAND =
  /\b(?:git\s+push|gh\s+release\s+upload|gh\s+gist\s+create|npm\s+publish|pnpm\s+publish|yarn\s+publish|docker\s+push|wrangler\s+(?:deploy|pages\s+deploy|r2\s+object\s+put)|vercel\s+deploy|netlify\s+deploy|firebase\s+deploy|aws\s+s3\s+(?:cp|sync)\s+\S+\s+s3:|gsutil\s+cp\s+\S+\s+gs:|huggingface-cli\s+upload|hf\s+upload)\b|\bcurl\b[^|;&]*(?:\s-T\s|--upload-file|\s-F\s|--form|--data-binary\s+@|-X\s*(?:POST|PUT))|\bscp\s+(?:-\S+\s+)*[^\s:]+\s+\S+:|\brsync\b[^|;&]*\s\S+:\S*\s*$/;
const DOWNLOAD_COMMAND =
  /\b(?:git\s+(?:clone|pull|fetch)|curl|wget|npm\s+(?:install|i|ci)|pnpm\s+(?:install|i|add)|yarn\s+(?:install|add)|npm\s+add|brew\s+install|pip3?\s+install|docker\s+pull|gh\s+(?:release\s+download|repo\s+clone|run\s+download)|aws\s+s3\s+(?:cp|sync)\s+s3:|gsutil\s+cp\s+gs:|huggingface-cli\s+download|hf\s+download|ollama\s+pull)\b|\bscp\s+(?:-\S+\s+)*\S+:\S*\s/;

/** Whether a tool call sends data up (uploads, pushes, deploys) or brings it down (downloads, clones, fetches). */
export function transferKind(toolName: string, input: Record<string, unknown> = {}): Transfer | null {
  const tool = toolName.replace(/^mcp__[^_]+__/, "").toLowerCase();
  if (toolName === "Bash" && typeof input.command === "string") {
    if (UPLOAD_COMMAND.test(input.command)) return "up";
    if (DOWNLOAD_COMMAND.test(input.command)) return "down";
    return null;
  }
  if (toolName === "WebFetch") return "down";
  if (/upload|publish|deploy|push/.test(tool)) return "up";
  if (/download|fetch_file|import_url|pull/.test(tool)) return "down";
  return null;
}
