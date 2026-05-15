/**
 * Walk PRODUCT_MCP_DATA_DIR for every PDF + sidecar pair on disk.
 *
 * Wave 4. Used by the parse status board to render which sources are parsed
 * vs. unparsed without requiring a fully-seeded `sources` table. The DB-backed
 * view is layered on top via parse_runs / sources joins; this module is the
 * filesystem source of truth.
 *
 * Distinct from `lib/pipeline/sources.ts` (Wave 6 — source-acquisition skill).
 * The names are intentionally different.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { KNOWN_CATEGORIES } from "@/lib/repo-walk";
import { listProductsOnDisk } from "@/lib/pipeline/products-on-disk";

const DATA_DIR = path.resolve(env.PRODUCT_MCP_DATA_DIR);

/** Directories we never recurse into (build artifacts, planning, viewer images). */
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "_planning",
  "_discovery",
  "images", // we don't index Reducto image crops
]);

export type SourceScope = "product" | "line" | "category";

export interface FsSourceEntry {
  /** Path-relative to PRODUCT_MCP_DATA_DIR (forward slashes). */
  sourcePath: string;
  /** Same path with `.pdf` -> `.md`; null when the source is already a .md (rare). */
  sidecarPath: string | null;
  /** True if the .md sidecar exists on disk. */
  hasSidecar: boolean;
  /** PDF size in bytes. */
  pdfBytes: number;
  /** Sidecar size in bytes (0 when missing). */
  sidecarBytes: number;
  /** Mtime of the sidecar, ISO; null if missing. */
  sidecarMtime: string | null;
  /** Mtime of the PDF, ISO. */
  pdfMtime: string;
  /** "product" | "line" | "category" — by directory layout. */
  scope: SourceScope;
  /** Category, vendor, product line, slug — only populated when path matches the canonical layout. */
  category: string | null;
  vendor: string | null;
  productLine: string | null;
  productSlug: string | null;
}

function walkPdfs(start: string, out: string[], depth = 0, maxDepth = 8): void {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(start, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIR_NAMES.has(e.name)) continue;
    // At DATA_DIR root, only descend into known category dirs (skips
    // legacy dell/, web/, schemas/, _planning/, etc).
    if (depth === 0 && start === DATA_DIR && !KNOWN_CATEGORIES.has(e.name)) {
      continue;
    }
    const fp = path.join(start, e.name);
    if (e.isDirectory()) {
      walkPdfs(fp, out, depth + 1, maxDepth);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) {
      out.push(fp);
    }
  }
}

/**
 * Classify a PDF path relative to PRODUCT_MCP_DATA_DIR into a (scope, category, ...)
 * tuple. Layout (per project conventions):
 *   {category}/{vendor}/{line}/{slug}/source/*.pdf       ← product scope
 *   {category}/{vendor}/{line}/source/*.pdf              ← line scope
 *   {category}/{vendor}/source/*.pdf                     ← category scope
 */
function classify(rel: string): {
  scope: SourceScope;
  category: string | null;
  vendor: string | null;
  productLine: string | null;
  productSlug: string | null;
} {
  const parts = rel.split("/");
  const sourceIdx = parts.lastIndexOf("source");
  if (sourceIdx === -1) {
    return {
      scope: "product",
      category: null,
      vendor: null,
      productLine: null,
      productSlug: null,
    };
  }
  // The pieces BEFORE "source/" are the directory chain.
  const prefix = parts.slice(0, sourceIdx);
  const [category, vendor, productLine, productSlug] = prefix;
  if (prefix.length === 4) {
    return {
      scope: "product",
      category: category ?? null,
      vendor: vendor ?? null,
      productLine: productLine ?? null,
      productSlug: productSlug ?? null,
    };
  }
  if (prefix.length === 3) {
    return {
      scope: "line",
      category: category ?? null,
      vendor: vendor ?? null,
      productLine: productLine ?? null,
      productSlug: null,
    };
  }
  if (prefix.length === 2) {
    return {
      scope: "category",
      category: category ?? null,
      vendor: vendor ?? null,
      productLine: null,
      productSlug: null,
    };
  }
  return {
    scope: "product",
    category: category ?? null,
    vendor: vendor ?? null,
    productLine: productLine ?? null,
    productSlug: productSlug ?? null,
  };
}

let _cache: { at: number; rows: FsSourceEntry[] } | null = null;
const CACHE_TTL_MS = 5 * 1000;

export function listAllSources(opts: { fresh?: boolean } = {}): FsSourceEntry[] {
  if (!opts.fresh && _cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.rows;
  }
  const pdfs: string[] = [];
  walkPdfs(DATA_DIR, pdfs);
  const rows: FsSourceEntry[] = [];
  for (const abs of pdfs) {
    const rel = path.relative(DATA_DIR, abs).split(path.sep).join("/");
    const sidecarRel = rel.replace(/\.pdf$/i, ".md");
    const sidecarAbs = path.join(DATA_DIR, sidecarRel);
    let pdfBytes = 0;
    let pdfMtime = new Date(0).toISOString();
    try {
      const st = fs.statSync(abs);
      pdfBytes = st.size;
      pdfMtime = st.mtime.toISOString();
    } catch {
      // skip
    }
    let hasSidecar = false;
    let sidecarBytes = 0;
    let sidecarMtime: string | null = null;
    try {
      const st = fs.statSync(sidecarAbs);
      hasSidecar = true;
      sidecarBytes = st.size;
      sidecarMtime = st.mtime.toISOString();
    } catch {
      // missing sidecar is normal
    }
    const cls = classify(rel);
    rows.push({
      sourcePath: rel,
      sidecarPath: sidecarRel,
      hasSidecar,
      pdfBytes,
      sidecarBytes,
      sidecarMtime,
      pdfMtime,
      ...cls,
    });
  }
  rows.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  _cache = { at: Date.now(), rows };
  return rows;
}

export function listSourcesForProduct(productSlug: string): FsSourceEntry[] {
  return listAllSources().filter(r => r.productSlug === productSlug);
}

export function listSourcesForLine(category: string, productLine: string): FsSourceEntry[] {
  return listAllSources().filter(
    r => r.category === category && r.productLine === productLine
  );
}

export function findSource(sourcePath: string): FsSourceEntry | null {
  return listAllSources().find(r => r.sourcePath === sourcePath) ?? null;
}

// ----------------------------------------------------------------------------
// Aggregations for the parse status board.
// ----------------------------------------------------------------------------

export interface ProductSourceSummary {
  category: string;
  productLine: string;
  productSlug: string;
  total: number;
  withSidecar: number;
  withoutSidecar: number;
}

export interface LineSourceSummary {
  category: string;
  productLine: string;
  totalProducts: number;
  totalSources: number;
  parsedSources: number;
  unparsedSources: number;
  /** Per-product breakdown so the bulk-reparse button can show counts. */
  products: ProductSourceSummary[];
  /** Line-scope sources (shared across the line). */
  lineSources: FsSourceEntry[];
}

export interface CategorySourceSummary {
  category: string;
  productLines: LineSourceSummary[];
  /** Category-scope sources. */
  categorySources: FsSourceEntry[];
}

export function summarizeByCategory(): CategorySourceSummary[] {
  const all = listAllSources();

  // Index FS sources by (category, line, slug) and by line (for line-scope).
  const productScopeByLine = new Map<string, Map<string, FsSourceEntry[]>>();
  const lineScopeByLine = new Map<string, FsSourceEntry[]>();
  const categoryScopeByCategory = new Map<string, FsSourceEntry[]>();
  for (const r of all) {
    if (!r.category) continue;
    if (r.scope === "product" && r.productSlug && r.productLine) {
      const lineKey = `${r.category}/${r.productLine}`;
      const slugMap = productScopeByLine.get(lineKey) ?? new Map();
      const arr = slugMap.get(r.productSlug) ?? [];
      arr.push(r);
      slugMap.set(r.productSlug, arr);
      productScopeByLine.set(lineKey, slugMap);
    } else if (r.scope === "line" && r.productLine) {
      const lineKey = `${r.category}/${r.productLine}`;
      const arr = lineScopeByLine.get(lineKey) ?? [];
      arr.push(r);
      lineScopeByLine.set(lineKey, arr);
    } else if (r.scope === "category") {
      const arr = categoryScopeByCategory.get(r.category) ?? [];
      arr.push(r);
      categoryScopeByCategory.set(r.category, arr);
    }
  }

  // Use listProductsOnDisk as the canonical product list — every product MD on
  // disk gets a row even when it has zero PDFs (renders as 0/0). This way the
  // parse page is an exhaustive enumeration of what's in the portfolio, not
  // just the products that already happen to have sources fetched.
  const productsOnDisk = listProductsOnDisk();
  const linesByCategory = new Map<string, Map<string, ProductSourceSummary[]>>();
  for (const p of productsOnDisk) {
    const lineKey = `${p.category}/${p.line}`;
    const slugMap = productScopeByLine.get(lineKey);
    const items = slugMap?.get(p.slug) ?? [];
    const total = items.length;
    const withSidecar = items.filter(r => r.hasSidecar).length;
    const summary: ProductSourceSummary = {
      category: p.category,
      productLine: p.line,
      productSlug: p.slug,
      total,
      withSidecar,
      withoutSidecar: total - withSidecar,
    };
    const linesMap = linesByCategory.get(p.category) ?? new Map();
    const arr = linesMap.get(p.line) ?? [];
    arr.push(summary);
    linesMap.set(p.line, arr);
    linesByCategory.set(p.category, linesMap);
  }

  // Add lines that exist only via line-scope sources (e.g. a brand-new line
  // with no per-product MDs yet) so they still surface on the page.
  for (const [lineKey] of lineScopeByLine) {
    const [category, productLine] = lineKey.split("/");
    if (!category || !productLine) continue;
    const linesMap = linesByCategory.get(category) ?? new Map();
    if (!linesMap.has(productLine)) {
      linesMap.set(productLine, []);
      linesByCategory.set(category, linesMap);
    }
  }

  const out: CategorySourceSummary[] = [];
  for (const category of KNOWN_CATEGORIES) {
    const linesMap = linesByCategory.get(category);
    if (!linesMap) continue;
    const productLines: LineSourceSummary[] = [];
    for (const [productLine, products] of linesMap) {
      products.sort((a, b) => a.productSlug.localeCompare(b.productSlug));
      const lineSources = lineScopeByLine.get(`${category}/${productLine}`) ?? [];
      const totalSources =
        products.reduce((acc, p) => acc + p.total, 0) + lineSources.length;
      const parsedSources =
        products.reduce((acc, p) => acc + p.withSidecar, 0) +
        lineSources.filter(r => r.hasSidecar).length;
      productLines.push({
        category,
        productLine,
        totalProducts: products.length,
        totalSources,
        parsedSources,
        unparsedSources: totalSources - parsedSources,
        products,
        lineSources,
      });
    }
    productLines.sort((a, b) => a.productLine.localeCompare(b.productLine));
    out.push({
      category,
      productLines,
      categorySources: categoryScopeByCategory.get(category) ?? [],
    });
  }
  return out;
}
