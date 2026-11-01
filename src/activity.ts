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

export function describeActivity(toolName: string): string {
  const mcp = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcp) {
    const [, server, tool] = mcp;
    if (server === "jarvis") return `${OWN[tool!] ?? "Working"}…`;
    if (server === "rea") return `Inspecting with REA: ${tool!.replace(/_/g, " ")}…`;
    return `Using ${server!.replace(/^plugin_[^_]+_/, "").replace(/[-_]/g, " ")}…`;
  }
  return `${BUILT_IN[toolName] ?? "Working"}…`;
}
