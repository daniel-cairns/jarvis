/**
 * The "second brain": a folder of plain markdown notes Astra can write, search and read back.
 * Plain files on purpose — you can open the same folder in any editor or knowledge-graph tool.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type NoteSummary = { path: string; title: string; modified: string };
export type SearchHit = NoteSummary & { snippet: string; score: number };

const FOLDER_SEGMENT = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "note";
}

/** Resolves a path inside the brain, refusing anything that escapes it. */
export function resolveInside(root: string, relPath: string): string {
  const abs = path.resolve(root, relPath);
  const rel = path.relative(path.resolve(root), abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path "${relPath}" is outside the brain folder`);
  }
  return abs;
}

function checkFolder(folder: string): string {
  const segments = folder.split("/").filter(Boolean);
  for (const s of segments) {
    if (!FOLDER_SEGMENT.test(s)) {
      throw new Error(`Folder segment "${s}" must be lowercase letters, digits and dashes`);
    }
  }
  return segments.join("/");
}

function titleOf(content: string, fallback: string): string {
  const fm = /^---\n[\s\S]*?^title:\s*(.+)$[\s\S]*?^---$/m.exec(content);
  if (fm?.[1]) return fm[1].trim().replace(/^"|"$/g, "");
  const h1 = /^#\s+(.+)$/m.exec(content);
  return h1?.[1]?.trim() ?? fallback;
}

export async function saveNote(
  brainDir: string,
  note: { title: string; body: string; folder?: string; tags?: string[] },
  now: Date = new Date(),
): Promise<string> {
  const folder = checkFolder(note.folder ?? "notes");
  const dir = path.join(brainDir, folder);
  await fs.mkdir(dir, { recursive: true });

  const date = now.toISOString().slice(0, 10);
  const base = `${date}-${slugify(note.title)}`;
  const tags = (note.tags ?? []).map((t) => slugify(t));
  const content = [
    "---",
    `title: ${JSON.stringify(note.title)}`,
    `created: ${now.toISOString()}`,
    `tags: [${tags.join(", ")}]`,
    "---",
    "",
    note.body.trimEnd(),
    "",
  ].join("\n");

  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.md` : `${base}-${i}.md`;
    try {
      // "wx" fails if the file exists, so two saves on the same day never overwrite each other.
      await fs.writeFile(path.join(dir, name), content, { flag: "wx" });
      return path.posix.join(folder, name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`Too many notes named "${base}" today`);
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

async function summarise(brainDir: string, file: string): Promise<NoteSummary & { content: string }> {
  const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  const rel = path.relative(brainDir, file).split(path.sep).join("/");
  return { path: rel, title: titleOf(content, path.basename(file, ".md")), modified: stat.mtime.toISOString(), content };
}

export async function listNotes(brainDir: string, folder?: string, limit = 20): Promise<NoteSummary[]> {
  const root = folder ? path.join(brainDir, checkFolder(folder)) : brainDir;
  const notes = await Promise.all((await walk(root)).map((f) => summarise(brainDir, f)));
  return notes
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, limit)
    .map(({ path: p, title, modified }) => ({ path: p, title, modified }));
}

export async function searchNotes(brainDir: string, query: string, limit = 8): Promise<SearchHit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const notes = await Promise.all((await walk(brainDir)).map((f) => summarise(brainDir, f)));

  const hits: SearchHit[] = [];
  for (const n of notes) {
    const title = n.title.toLowerCase();
    const body = n.content.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 5;
      score += Math.min(body.split(t).length - 1, 10);
    }
    if (score === 0) continue;
    const first = terms.map((t) => body.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, first - 80);
    const snippet = n.content.slice(start, start + 240).replace(/\s+/g, " ").trim();
    hits.push({ path: n.path, title: n.title, modified: n.modified, snippet, score });
  }
  return hits.sort((a, b) => b.score - a.score || b.modified.localeCompare(a.modified)).slice(0, limit);
}

/** Splits markdown into its `#`/`##`/`###` sections, keeping each heading with its body. */
export function sections(content: string): { heading: string; body: string }[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const out: { heading: string; body: string }[] = [];
  let current = { heading: "(intro)", lines: [] as string[] };
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^#{1,3}\s+(.+)$/.exec(line);
    if (m?.[1]) {
      if (current.lines.join("").trim() || current.heading !== "(intro)") {
        out.push({ heading: current.heading, body: current.lines.join("\n").trim() });
      }
      current = { heading: m[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  out.push({ heading: current.heading, body: current.lines.join("\n").trim() });
  return out;
}

export async function readNote(
  brainDir: string,
  relPath: string,
  section?: string,
): Promise<{ path: string; title: string; text: string; sections: string[] }> {
  const abs = resolveInside(brainDir, relPath);
  const content = await fs.readFile(abs, "utf8");
  const parts = sections(content);
  const headings = parts.map((p) => p.heading);
  const title = titleOf(content, path.basename(abs, ".md"));
  if (section === undefined) return { path: relPath, title, text: content, sections: headings };

  const wanted = section.toLowerCase();
  const match =
    parts.find((p) => p.heading.toLowerCase() === wanted) ??
    parts.find((p) => p.heading.toLowerCase().includes(wanted));
  if (!match) throw new Error(`No section matching "${section}". Sections: ${headings.join(" | ")}`);
  return { path: relPath, title, text: `${match.heading}\n\n${match.body}`, sections: headings };
}

export type BrainEntry = NoteSummary & { folder: string; snippet: string; hasMap: boolean };

const MAP_BLOCK = /```astra-graph\s*\n([\s\S]*?)\n```/;

/** Every note for the brain browser: newest first, with its folder, a plain-text snippet and whether it has a map. */
export async function brainIndex(brainDir: string): Promise<BrainEntry[]> {
  const notes = await Promise.all((await walk(brainDir)).map((f) => summarise(brainDir, f)));
  return notes
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .map(({ path: p, title, modified, content }) => ({
      path: p,
      title,
      modified,
      folder: p.includes("/") ? p.split("/")[0]! : "notes",
      hasMap: MAP_BLOCK.test(content),
      snippet: content
        .replace(/^---[\s\S]*?---\n/, "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[#*_`>|-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220),
    }));
}

/** The map saved in a note's astra-graph block, parsed but not yet validated; null if the note has none. */
export async function noteMap(brainDir: string, relPath: string): Promise<unknown | null> {
  const content = await fs.readFile(resolveInside(brainDir, relPath), "utf8");
  const block = content.match(MAP_BLOCK)?.[1];
  if (!block) return null;
  try {
    return JSON.parse(block);
  } catch {
    throw new Error("The note's map block isn't valid JSON");
  }
}
