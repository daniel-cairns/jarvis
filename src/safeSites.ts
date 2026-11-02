/**
 * The safe-site list: hosts Astra may fetch pages from without asking. Anything else asks first, so a page she's
 * tearing down can't talk her into sending your data to a URL of its choosing. The list lives in
 * ~/.jarvis/safe-sites.json ({"sites": [...]}) so you can edit it without touching code.
 */
import fs from "node:fs";
import path from "node:path";

// Documentation and package sites she reads often. No free hosting (pages.dev, vercel.app, netlify.app):
// anyone can put a site there and read its request logs.
export const DEFAULT_SAFE_SITES = [
  "developer.mozilla.org",
  "vuejs.org",
  "nuxt.com",
  "nodejs.org",
  "typescriptlang.org",
  "electronjs.org",
  "developers.cloudflare.com",
  "github.com",
  "npmjs.com",
  "anthropic.com",
  "claude.com",
  "huggingface.co",
];

const FILE = "safe-sites.json";

/** "https://Docs.Example.com:443/path" or ".example.com" → "docs.example.com" / "example.com". */
export function normaliseSite(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\.+/, "");
}

/** The list from ~/.jarvis/safe-sites.json. Missing: created with the defaults. Unreadable: empty, so everything asks. */
export function loadSafeSites(home: string): string[] {
  const file = path.join(home, FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ sites: DEFAULT_SAFE_SITES }, null, 2)}\n`);
    return [...DEFAULT_SAFE_SITES];
  }
  try {
    const sites = (JSON.parse(text) as { sites?: unknown }).sites;
    if (!Array.isArray(sites)) throw new Error('expected {"sites": [...]}');
    return sites.filter((s): s is string => typeof s === "string").map(normaliseSite).filter(Boolean);
  } catch (err) {
    console.warn(`  (${file} couldn't be read, so every page fetch will ask first: ${(err as Error).message})`);
    return [];
  }
}

/** The host of an http(s) URL, or null for anything else. */
export function hostOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** A listed site or one of its subdomains ("docs.github.com" for "github.com"), never a lookalike ("evilgithub.com"). */
export function isSafeHost(host: string, sites: readonly string[]): boolean {
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}
