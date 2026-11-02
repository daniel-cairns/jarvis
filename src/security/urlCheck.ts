/**
 * The security check a URL gets before Astra fetches it: signs in the address itself (checked in code, nothing leaves
 * the Mac), then public threat indexes. A threat-index hit blocks the fetch; softer signs make it ask you first.
 *
 * Indexes: Quad9's threat-intelligence DNS (no account; a blocked name resolves on 9.9.9.10 but not 9.9.9.9), and,
 * when their keys are set, Google Safe Browsing and abuse.ch's URLhaus. Those two are sent the address without its
 * query string or fragment, so data riding in the URL doesn't reach them either.
 */
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { parse } from "tldts";

export type UrlVerdict = {
  verdict: "ok" | "warn" | "block";
  /** Why it was blocked or needs asking, in plain words. */
  reasons: string[];
  /** Indexes that couldn't be asked (no key, timed out, offline). */
  unchecked: string[];
};

export type IndexKeys = { safeBrowsing?: string; urlhaus?: string };

// ── Signs in the address itself ──

const PRIVATE_V4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/;
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/;
const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\/(?:Users|home)\/[\w.-]+/;
const BLOB = /^[A-Za-z0-9+/_=-]{40,}$|^[0-9a-f]{32,}$/i;

/** Signs in the URL itself that it may be unsafe, or may be carrying your data out. Empty means none. */
export function addressFindings(raw: string): string[] {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return ["it isn't a valid web address"];
  }
  const found: string[] = [];
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" && url.protocol !== "http:") return [`it uses ${url.protocol} rather than the web`];
  if (url.protocol === "http:") found.push("it isn't encrypted (http)");
  if (url.username || url.password) found.push("it has a username or password in it");
  if (isIP(host)) {
    found.push(PRIVATE_V4.test(host) || host === "::1" || /^f[cd]/.test(host) ? "it points at your own network" : "it's a bare IP address, not a site name");
  } else if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    found.push("it points at your own machine or network");
  }
  if (url.port && url.port !== "80" && url.port !== "443") found.push(`it uses an unusual port (${url.port})`);
  if (host.split(".").some((label) => label.startsWith("xn--"))) found.push("its name uses look-alike international characters (punycode)");
  if (parse(host, { allowPrivateDomains: true }).isPrivate) found.push("it's on shared hosting, where anyone can publish a site");
  const query = url.search + url.hash;
  if (query.length > 300) found.push("its address is unusually long, as if carrying data");
  else if ([...url.searchParams.values()].some((v) => BLOB.test(v))) found.push("its address carries a long encoded value");
  const decoded = safeDecode(url.pathname + query);
  if (SECRET.test(decoded)) found.push("its address seems to contain an access key");
  else if (PERSONAL.test(decoded)) found.push("its address seems to contain personal details (an email or a home folder)");
  return found;
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// ── Public threat indexes ──

export type IndexDeps = {
  /** Resolves a host on one DNS server; resolves true if it exists, false for "no such name", throws otherwise. */
  resolveOn?: (server: string, host: string) => Promise<boolean>;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

async function resolveOn(server: string, host: string): Promise<boolean> {
  const r = new Resolver({ timeout: 2500, tries: 1 });
  r.setServers([server]);
  try {
    await r.resolve4(host);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND") return false;
    // No IPv4 record: try IPv6 before deciding.
    if (code === "ENODATA") return r.resolve6(host).then(() => true, (e: NodeJS.ErrnoException) => (e.code === "ENOTFOUND" ? false : Promise.reject(e)));
    throw err;
  }
}

/** Quad9 blocks known-malicious names: they vanish on its filtered resolver (9.9.9.9) but exist on 9.9.9.10. */
async function quad9(host: string, deps: IndexDeps): Promise<boolean> {
  const look = deps.resolveOn ?? resolveOn;
  const [filtered, unfiltered] = await Promise.all([look("9.9.9.9", host), look("9.9.9.10", host)]);
  return !filtered && unfiltered;
}

async function safeBrowsing(bareUrl: string, key: string, deps: IndexDeps): Promise<string | null> {
  // The key goes in the x-goog-api-key header, as Google recommends, not the URL, where proxies and logs record it.
  const res = await (deps.fetch ?? fetch)("https://safebrowsing.googleapis.com/v4/threatMatches:find", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      client: { clientId: "astra", clientVersion: "0.1.0" },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url: bareUrl }],
      },
    }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { matches?: { threatType?: string }[] };
  const type = body.matches?.[0]?.threatType;
  return type ? type.toLowerCase().replace(/_/g, " ") : null;
}

async function urlhaus(bareUrl: string, key: string, deps: IndexDeps): Promise<boolean> {
  const res = await (deps.fetch ?? fetch)("https://urlhaus-api.abuse.ch/v1/url/", {
    method: "POST",
    headers: { "Auth-Key": key, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ url: bareUrl }).toString(),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { query_status?: string };
  if (body.query_status === "ok") return true;
  if (body.query_status === "no_results") return false;
  throw new Error(body.query_status ?? "unexpected answer");
}

/** Asks the threat indexes about a URL. Each that lists it adds a reason; each that couldn't be asked is noted. */
export async function indexFindings(raw: string, keys: IndexKeys, deps: IndexDeps = {}): Promise<{ listed: string[]; unchecked: string[] }> {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const bare = `${url.protocol}//${url.host}${url.pathname}`;
  const listed: string[] = [];
  const unchecked: string[] = [];
  const ask = async (name: string, run: () => Promise<string | null>) => {
    try {
      const hit = await run();
      if (hit) listed.push(hit);
    } catch {
      unchecked.push(`${name} (no answer)`);
    }
  };
  await Promise.all([
    isIP(host) ? Promise.resolve() : ask("Quad9", async () => ((await quad9(host, deps)) ? "Quad9's threat list blocks this site" : null)),
    keys.safeBrowsing
      ? ask("Google Safe Browsing", async () => {
          const threat = await safeBrowsing(bare, keys.safeBrowsing!, deps);
          return threat ? `Google Safe Browsing lists it (${threat})` : null;
        })
      : (unchecked.push("Google Safe Browsing (no key)"), Promise.resolve()),
    keys.urlhaus
      ? ask("URLhaus", async () => ((await urlhaus(bare, keys.urlhaus!, deps)) ? "URLhaus lists it as a malware site" : null))
      : (unchecked.push("URLhaus (no key)"), Promise.resolve()),
  ]);
  return { listed, unchecked };
}

// ── The check ──

const cache = new Map<string, { at: number; result: UrlVerdict }>();
const CACHE_MS = 30 * 60_000;

/** The full check: blocked if a threat index lists it, "warn" if the address itself looks risky, else ok. */
export async function checkUrl(raw: string, keys: IndexKeys, deps: IndexDeps = {}): Promise<UrlVerdict> {
  const signs = addressFindings(raw);
  let url: URL;
  try {
    url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not the web");
  } catch {
    return { verdict: "warn", reasons: signs, unchecked: [] };
  }
  // Index answers are cached per address (without its query), since they don't depend on it.
  const cacheKey = `${url.protocol}//${url.host}${url.pathname}`;
  const hit = cache.get(cacheKey);
  const fresh = hit && Date.now() - hit.at < CACHE_MS;
  const indexes = fresh
    ? { listed: hit.result.verdict === "block" ? hit.result.reasons : [], unchecked: hit.result.unchecked }
    : await indexFindings(raw, keys, deps);
  if (indexes.listed.length) {
    if (!fresh) cache.set(cacheKey, { at: Date.now(), result: { verdict: "block", reasons: indexes.listed, unchecked: indexes.unchecked } });
    return { verdict: "block", reasons: [...indexes.listed, ...signs], unchecked: indexes.unchecked };
  }
  // An index that was asked but didn't answer (a Quad9 timeout, an outage) means "not checked", not "clean": it used
  // to come out "ok" and be cached for half an hour, so one slow lookup let a site through unchecked. Now Dan is
  // asked (a "warn" becomes an approval card) and nothing is cached, so the next attempt checks again.
  const silent = indexes.unchecked.filter((u) => u.endsWith("(no answer)"));
  if (silent.length) {
    const names = silent.map((u) => u.replace(/ \(no answer\)$/, "")).join(" and ");
    return { verdict: "warn", reasons: [`couldn't confirm it's safe: ${names} didn't answer`, ...signs], unchecked: indexes.unchecked };
  }
  if (!fresh) cache.set(cacheKey, { at: Date.now(), result: { verdict: "ok", reasons: [], unchecked: indexes.unchecked } });
  return { verdict: signs.length ? "warn" : "ok", reasons: signs, unchecked: indexes.unchecked };
}

/** For tests: forget cached index answers. */
export const clearUrlCheckCache = () => cache.clear();
