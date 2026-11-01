import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentType, resolveRequest, serveApp, stopServing } from "../src/tools/serve.js";

let workspace: string;
let site: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "astra-serve-"));
  site = path.join(workspace, "quire", ".output", "public");
  await fs.mkdir(path.join(site, "_nuxt"), { recursive: true });
  await fs.writeFile(path.join(site, "index.html"), "<h1>home</h1>");
  await fs.writeFile(path.join(site, "200.html"), "<h1>app shell</h1>");
  await fs.writeFile(path.join(site, "_nuxt", "app.js"), "console.log(1)");
  await fs.writeFile(path.join(workspace, "secret.txt"), "not for the browser");
});

afterAll(async () => {
  stopServing();
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("resolveRequest", () => {
  it("finds files, folder indexes, and falls back to the app shell for client routes", async () => {
    expect(await resolveRequest(site, "/_nuxt/app.js?v=2")).toBe(path.join(site, "_nuxt", "app.js"));
    expect(await resolveRequest(site, "/")).toBe(path.join(site, "index.html"));
    expect(await resolveRequest(site, "/notes/42")).toBe(path.join(site, "200.html"));
  });

  it("never escapes the served folder", async () => {
    for (const p of ["/../../secret.txt", "/%2e%2e/%2e%2e/secret.txt", "/..%2f..%2fsecret.txt"]) {
      expect(await resolveRequest(site, p)).not.toBe(path.join(workspace, "secret.txt"));
    }
    expect(await resolveRequest(site, "/%E0%A4%A")).toBeNull();
  });
});

describe("serveApp", () => {
  it("serves a workspace app on loopback with the right content types", async () => {
    const url = await serveApp("quire/.output/public", workspace);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(await serveApp("quire/.output/public", workspace)).toBe(url);
    const js = await fetch(`${url}_nuxt/app.js`);
    expect(js.headers.get("content-type")).toBe(contentType("a.js"));
    expect(await (await fetch(`${url}notes/1`)).text()).toBe("<h1>app shell</h1>");
  });

  it("refuses folders outside the workspace or without a built app", async () => {
    await expect(serveApp("/etc", workspace)).rejects.toThrow("inside the workspace");
    await expect(serveApp("quire", workspace)).rejects.toThrow("No index.html");
  });
});
