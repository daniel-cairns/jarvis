/** Read-only git queries for the git changes panel: repo root, branch, changed files with line counts, a file's diff. */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const git = async (root: string, args: string[]) =>
  (await execFileAsync("git", ["-C", root, ...args], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 })).stdout;

export type GitFile = { path: string; status: string; added: number; removed: number };
export type RepoState = { name: string; root: string; branch: string; files: GitFile[] };

export async function gitRoot(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

/** `git status --porcelain=v1` → path and a two-letter status ("M ", " M", "??", "A ", "D " …). */
export function parsePorcelain(text: string): { path: string; status: string }[] {
  return text
    .split("\n")
    .filter((l) => l.length > 3)
    .map((l) => {
      const status = l.slice(0, 2);
      const rest = l.slice(3);
      // Renames show "old -> new"; the panel shows the new name.
      const file = rest.includes(" -> ") ? rest.split(" -> ").at(-1)! : rest;
      return { path: file.replace(/^"|"$/g, ""), status };
    });
}

/** `git diff --numstat` → added/removed lines per file (binary files count as 0). */
export function parseNumstat(text: string): Map<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>();
  for (const l of text.split("\n")) {
    const [a, r, ...p] = l.split("\t");
    if (!p.length) continue;
    const file = p.join("\t").replace(/^.*=> /, "").replace(/[{}]/g, "");
    const prev = out.get(file) ?? { added: 0, removed: 0 };
    out.set(file, { added: prev.added + (Number(a) || 0), removed: prev.removed + (Number(r) || 0) });
  }
  return out;
}

export async function repoState(root: string): Promise<RepoState> {
  const [branch, status, unstaged, staged] = await Promise.all([
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "?"),
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(root, ["diff", "--numstat"]).catch(() => ""),
    git(root, ["diff", "--cached", "--numstat"]).catch(() => ""),
  ]);
  const counts = parseNumstat(`${unstaged}\n${staged}`);
  const files = parsePorcelain(status)
    .slice(0, 200)
    .map((f) => ({ ...f, ...(counts.get(f.path) ?? { added: 0, removed: 0 }) }));
  return { name: path.basename(root), root, branch: branch.trim(), files };
}

/** A file's diff against HEAD (staged and unstaged); for a new, untracked file, its contents. */
export async function fileDiff(root: string, file: string): Promise<string> {
  const abs = path.resolve(root, file);
  if (path.relative(root, abs).startsWith("..")) throw new Error("That file isn't in the repo");
  const diff = await git(root, ["diff", "HEAD", "--", file]).catch(() => "");
  if (diff.trim()) return diff.slice(0, 200_000);
  const text = await fs.readFile(abs, "utf8").catch(() => "");
  const lines = text.split("\n").slice(0, 400);
  return [`new file: ${file}`, ...lines.map((l) => `+${l}`)].join("\n");
}
