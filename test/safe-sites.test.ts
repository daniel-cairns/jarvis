import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SAFE_SITES, hostOf, isSafeHost, loadSafeSites, normaliseSite } from "../src/safeSites.js";

const homes: string[] = [];
const tempHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "astra-safe-sites-"));
  homes.push(home);
  return home;
};
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("isSafeHost", () => {
  it("allows a listed host and its subdomains, never a lookalike", () => {
    const sites = ["vuejs.org"];
    expect(isSafeHost("vuejs.org", sites)).toBe(true);
    expect(isSafeHost("blog.vuejs.org", sites)).toBe(true);
    expect(isSafeHost("evilvuejs.org", sites)).toBe(false);
    expect(isSafeHost("vuejs.org.attacker.com", sites)).toBe(false);
  });
});

describe("hostOf", () => {
  it("reads hosts from http(s) URLs only", () => {
    expect(hostOf("https://Docs.GitHub.com/en?x=1")).toBe("docs.github.com");
    expect(hostOf("http://localhost:3000/")).toBe("localhost");
    expect(hostOf("file:///etc/passwd")).toBeNull();
    expect(hostOf("ftp://example.com/")).toBeNull();
    expect(hostOf("nonsense")).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });
});

describe("normaliseSite", () => {
  it("keeps only the host, lower case", () => {
    expect(normaliseSite(" https://Nuxt.com:443/docs ")).toBe("nuxt.com");
    expect(normaliseSite(".github.com")).toBe("github.com");
  });
});

describe("loadSafeSites", () => {
  it("creates the file with the defaults when it's missing", () => {
    const home = tempHome();
    expect(loadSafeSites(home)).toEqual(DEFAULT_SAFE_SITES);
    const saved = JSON.parse(fs.readFileSync(path.join(home, "safe-sites.json"), "utf8"));
    expect(saved).toEqual({ sites: DEFAULT_SAFE_SITES });
    expect(DEFAULT_SAFE_SITES.some((s) => /pages\.dev|vercel\.app|netlify\.app/.test(s))).toBe(false);
  });

  it("reads and normalises an edited list", () => {
    const home = tempHome();
    fs.writeFileSync(path.join(home, "safe-sites.json"), JSON.stringify({ sites: ["HTTPS://Example.com/path", 42, ""] }));
    expect(loadSafeSites(home)).toEqual(["example.com"]);
  });

  it("gives an empty list (everything asks) when the file is corrupt", () => {
    const home = tempHome();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.writeFileSync(path.join(home, "safe-sites.json"), "{ not json");
    expect(loadSafeSites(home)).toEqual([]);
    fs.writeFileSync(path.join(home, "safe-sites.json"), JSON.stringify(["vuejs.org"]));
    expect(loadSafeSites(home)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
