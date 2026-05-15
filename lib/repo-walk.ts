import fs from "node:fs";
import path from "node:path";

/**
 * Root directory the viewer reads data from. Configured via the `DATA_ROOT`
 * env var; defaults to a tiny sample dataset shipped with the repo so a fresh
 * clone boots out-of-the-box. Point this at a real product knowledgebase to
 * use the viewer over your own data.
 */
export const DATA_ROOT = path.resolve(
  process.cwd(),
  process.env.DATA_ROOT ?? "data/sample"
);

/** Back-compat alias. Prefer `DATA_ROOT` in new code. */
export const REPO_ROOT = DATA_ROOT;

const SKIP_NAMES = new Set([
  "node_modules",
  "source",
  ".git",
  ".next",
  "dist",
  "build",
  "_planning",
  "_discovery"
]);

/** Recursively walk repo, calling visitor on each directory. depth limit avoids runaway. */
export function walkDirs(
  start: string,
  visitor: (absDir: string, relDir: string) => void,
  maxDepth = 8
): void {
  const stack: Array<{ abs: string; rel: string; depth: number }> = [
    { abs: start, rel: "", depth: 0 }
  ];
  while (stack.length) {
    const { abs, rel, depth } = stack.pop()!;
    visitor(abs, rel);
    if (depth >= maxDepth) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (SKIP_NAMES.has(entry.name)) continue;
      stack.push({
        abs: path.join(abs, entry.name),
        rel: rel ? `${rel}/${entry.name}` : entry.name,
        depth: depth + 1
      });
    }
  }
}

/** True if a dir looks like a per-product dir: contains extraction.json or sources.yaml or source/. */
export function isProductDir(absDir: string): boolean {
  return (
    fs.existsSync(path.join(absDir, "extraction.json")) ||
    fs.existsSync(path.join(absDir, "sources.yaml")) ||
    fs.existsSync(path.join(absDir, "source"))
  );
}

/** Returns "{category}/{vendor}/{product-line}/{slug}" path components when relDir matches. */
export function parseProductRelDir(relDir: string): {
  category: string;
  vendor: string;
  product_line: string;
  slug: string;
} | null {
  const parts = relDir.split("/");
  if (parts.length < 4) return null;
  const [category, vendor, product_line, slug] = parts;
  if (!category || !vendor || !product_line || !slug) return null;
  return { category, vendor, product_line, slug };
}
