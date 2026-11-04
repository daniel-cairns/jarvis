/**
 * Connectors that hang while their app is closed. Astra adds her own tools to each request, and when a request brings
 * its own, Claude Code waits for every connector to start before it begins. Unity's relay connects but never lists
 * its tools while the Unity editor is closed, so every request waited out a 30-second timeout (measured: ready in
 * 32.6 s, against 5.3 s without it). While the app is closed, the connector is swapped for one that exits at once, so
 * it fails straight away instead. When the app is open it loads as normal.
 */
import { execFileSync } from "node:child_process";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

/** Connector name → the process name of the app it needs. */
export const NEEDS_APP: Readonly<Record<string, string>> = { "unity-mcp": "Unity" };

/** A connector that exits immediately: Claude Code marks it failed without waiting. */
const STAND_IN: McpServerConfig = { type: "stdio", command: "/usr/bin/true", args: [] };

/** Whether a process with exactly this name is running. */
export function appRunning(name: string): boolean {
  try {
    execFileSync("pgrep", ["-x", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Stand-ins for the connectors whose app is closed right now, to add to a request's MCP servers. */
export function idleConnectors(running: (app: string) => boolean = appRunning): Record<string, McpServerConfig> {
  return Object.fromEntries(Object.entries(NEEDS_APP).filter(([, app]) => !running(app)).map(([name]) => [name, STAND_IN]));
}
