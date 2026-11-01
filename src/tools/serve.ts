/**
 * Serves a built web app (a folder with index.html, e.g. Nuxt's `.output/public` after `nuxi generate`) on
 * 127.0.0.1 so it can be opened in a browser. Only folders inside Astra's workspace; nothing outside the root is served.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { isInside } from "./mac.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export const contentType = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * Maps a request path to a file under root: exact file, then folder/index.html, then the app's fallback page
 * (200.html or index.html) for client-side routes. Returns null for anything that would escape root.
 */
export async function resolveRequest(root: string, urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  } catch {
    return null;
  }
  const target = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  if (target !== path.resolve(root) && !isInside(root, target)) return null;
  const candidates = [target, path.join(target, "index.html"), path.join(root, "200.html"), path.join(root, "index.html")];
  for (const file of candidates) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) return file;
  }
  return null;
}

const servers = new Map<string, { server: http.Server; url: string }>();

/** Starts (or reuses) a loopback server for `dir` and returns its URL. */
export async function serveApp(dir: string, workspaceDir: string): Promise<string> {
  const root = path.resolve(workspaceDir, dir);
  if (!isInside(workspaceDir, root)) throw new Error(`Only folders inside the workspace can be served, not "${dir}"`);
  if (!(await fs.stat(path.join(root, "index.html")).catch(() => null))?.isFile()) {
    throw new Error(`No index.html in ${root}. Build the app as static files first (for Nuxt: npx nuxi generate, then serve .output/public).`);
  }
  const existing = servers.get(root);
  if (existing) return existing.url;

  const server = http.createServer(async (req, res) => {
    const file = await resolveRequest(root, req.url ?? "/");
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
    res.end(await fs.readFile(file));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  servers.set(root, { server, url });
  return url;
}

export function stopServing(): void {
  for (const { server } of servers.values()) server.close();
  servers.clear();
}
