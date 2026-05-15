import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Root of the product data tree (schemas, source MDs, product MDs,
 * extractions). Configured via the `PRODUCT_MCP_DATA_DIR` env var; defaults
 * to `./data/sample` so a fresh clone boots out-of-the-box. All path
 * traversal helpers root here.
 */
export const REPO_ROOT = path.resolve(env.PRODUCT_MCP_DATA_DIR);
export const DATA_ROOT = REPO_ROOT;

/**
 * Known top-level category directories. Walkers only descend into these
 * at depth 0 — guards against picking up unrelated sibling directories
 * (build output, vendor-side artifacts, planning docs, etc.).
 */
export const KNOWN_CATEGORIES = new Set([
  "server",
  "storage",
  "hci",
  "networking",
  "chassis",
  "software-defined-infrastructure",
]);

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
      // At repo root, only descend into known category directories.
      // Skips legacy `dell/`, `web/`, `schemas/`, etc.
      if (depth === 0 && abs === start && !KNOWN_CATEGORIES.has(entry.name)) {
        continue;
      }
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
