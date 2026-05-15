/**
 * Parse-status aggregations layered on top of the filesystem walker
 * (`sources-fs`) and the `parse_runs` DB table. Used by the parse status
 * board and per-product detail page.
 *
 * The filesystem is the source of truth for "is there a sidecar"; the DB
 * carries the lineage (which parse runs we attempted, when, with what
 * validation). A source can have N historical parse_runs rows but at most
 * one current sidecar.
 */
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";
import {
  listAllSources,
  listSourcesForProduct,
  summarizeByCategory,
  type FsSourceEntry,
  type CategorySourceSummary,
  type ProductSourceSummary,
} from "@/lib/pipeline/sources-fs";

export type ParseStatus = "queued" | "running" | "completed" | "failed" | "none";

export interface ParseRunRow {
  id: number;
  source_id: number | null;
  source_path: string;
  reducto_job_id: string | null;
  status: string;
  output_md_path: string | null;
  validation_json: string | null;
  validation: unknown;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SourceWithStatus extends FsSourceEntry {
  /** Most recent parse_run row, or null if none exists. */
  latestRun: ParseRunRow | null;
  /** Aggregate status: `latestRun?.status` if present, else "none". */
  effectiveStatus: ParseStatus;
}

function readParseRun(row: any): ParseRunRow | null {
  if (!row) return null;
  let validation: unknown = null;
  if (row.validation_json) {
    try {
      validation = JSON.parse(row.validation_json);
    } catch {
      validation = { raw: row.validation_json };
    }
  }
  return { ...row, validation } as ParseRunRow;
}

/**
 * Loads, for each source path, the latest parse_runs row (by started_at desc).
 */
function loadLatestRunsByPath(sourcePaths: string[]): Map<string, ParseRunRow> {
  if (sourcePaths.length === 0) return new Map();
  ensureStudioSchema();
  const db = getStudioDb();
  // SQLite `IN (?, ?, ...)` — chunk to be safe.
  const out = new Map<string, ParseRunRow>();
  const chunkSize = 500;
  for (let i = 0; i < sourcePaths.length; i += chunkSize) {
    const chunk = sourcePaths.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, source_id, source_path, reducto_job_id, status,
                output_md_path, validation_json, error, started_at, completed_at
         FROM parse_runs
         WHERE source_path IN (${placeholders})
         ORDER BY datetime(started_at) DESC`
      )
      .all(...chunk) as any[];
    for (const r of rows) {
      if (!out.has(r.source_path)) {
        out.set(r.source_path, readParseRun(r)!);
      }
    }
  }
  return out;
}

export function getParseRunsForPath(sourcePath: string): ParseRunRow[] {
  ensureStudioSchema();
  const db = getStudioDb();
  const rows = db
    .prepare(
      `SELECT id, source_id, source_path, reducto_job_id, status,
              output_md_path, validation_json, error, started_at, completed_at
       FROM parse_runs WHERE source_path = ?
       ORDER BY datetime(started_at) DESC`
    )
    .all(sourcePath) as any[];
  return rows.map(readParseRun).filter((r): r is ParseRunRow => r !== null);
}

export function getParseRunById(id: number): ParseRunRow | null {
  ensureStudioSchema();
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT id, source_id, source_path, reducto_job_id, status,
              output_md_path, validation_json, error, started_at, completed_at
       FROM parse_runs WHERE id = ?`
    )
    .get(id);
  return readParseRun(row);
}

function effectiveStatusFor(
  fs: FsSourceEntry,
  latest: ParseRunRow | null
): ParseStatus {
  if (latest) {
    const s = latest.status;
    if (s === "queued" || s === "running" || s === "completed" || s === "failed") {
      return s;
    }
  }
  // No run on file. The sidecar may still exist (seeded or hand-parsed).
  if (fs.hasSidecar) return "completed";
  return "none";
}

// ----------------------------------------------------------------------------
// Per-product
// ----------------------------------------------------------------------------

export function listProductSourcesWithStatus(productSlug: string): SourceWithStatus[] {
  const fs = listSourcesForProduct(productSlug);
  const latestMap = loadLatestRunsByPath(fs.map(s => s.sourcePath));
  return fs.map(s => {
    const latest = latestMap.get(s.sourcePath) ?? null;
    return {
      ...s,
      latestRun: latest,
      effectiveStatus: effectiveStatusFor(s, latest),
    } satisfies SourceWithStatus;
  });
}

// ----------------------------------------------------------------------------
// Top-level board
// ----------------------------------------------------------------------------

export interface LineParseSummary {
  category: string;
  productLine: string;
  totalProducts: number;
  totalSources: number;
  parsed: number;
  unparsed: number;
  queued: number;
  running: number;
  failed: number;
  products: (ProductSourceSummary & {
    queued: number;
    running: number;
    failed: number;
  })[];
  /** Line-scope sources (covers multiple SKUs in one PDF). Used by the
   *  "Extract products" button to enumerate SKUs within a parsed line-source. */
  lineSources: (FsSourceEntry & { effectiveStatus: ParseStatus })[];
}

export interface CategoryParseSummary {
  category: string;
  productLines: LineParseSummary[];
}

export function summarizeBoard(): CategoryParseSummary[] {
  const cats = summarizeByCategory();
  const all = listAllSources();
  const latestMap = loadLatestRunsByPath(all.map(s => s.sourcePath));

  // Index latest runs by (productLine, productSlug) and by line for aggregation.
  const out: CategoryParseSummary[] = [];
  for (const cat of cats) {
    const catLines: LineParseSummary[] = [];
    for (const line of cat.productLines) {
      let queued = 0;
      let running = 0;
      let failed = 0;
      const products = line.products.map(p => {
        let pq = 0;
        let pr = 0;
        let pf = 0;
        for (const src of all) {
          if (src.productSlug === p.productSlug && src.productLine === p.productLine) {
            const latest = latestMap.get(src.sourcePath);
            const status = effectiveStatusFor(src, latest ?? null);
            if (status === "queued") {
              pq++;
              queued++;
            } else if (status === "running") {
              pr++;
              running++;
            } else if (status === "failed") {
              pf++;
              failed++;
            }
          }
        }
        return { ...p, queued: pq, running: pr, failed: pf };
      });
      // Line-scope sources too. Annotate each with its effectiveStatus so the
      // UI can decide whether to enable the "Extract products" button.
      const lineSources: LineParseSummary["lineSources"] = [];
      for (const src of line.lineSources) {
        const latest = latestMap.get(src.sourcePath);
        const status = effectiveStatusFor(src, latest ?? null);
        if (status === "queued") queued++;
        else if (status === "running") running++;
        else if (status === "failed") failed++;
        lineSources.push({ ...src, effectiveStatus: status });
      }
      catLines.push({
        category: cat.category,
        productLine: line.productLine,
        totalProducts: line.totalProducts,
        totalSources: line.totalSources,
        parsed: line.parsedSources,
        unparsed: line.unparsedSources,
        queued,
        running,
        failed,
        products,
        lineSources,
      });
    }
    out.push({ category: cat.category, productLines: catLines });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Manifest match — does the sidecar's local_extraction appear in any product MD's sources?
// ----------------------------------------------------------------------------

export interface ManifestMatch {
  matched: boolean;
  productSlugs: string[];
}

export function manifestMatchForSidecar(sidecarRelPath: string): ManifestMatch {
  // Cheap check via DB sources rows. If the seed populated them, we can answer
  // by matching `local_path` (which is the PDF) against the sidecar's PDF
  // counterpart. Otherwise we report "unknown" via matched=false (no harm).
  ensureStudioSchema();
  const db = getStudioDb();
  const pdfPath = sidecarRelPath.replace(/\.md$/i, ".pdf");
  const rows = db
    .prepare(`SELECT product_slug FROM sources WHERE local_path = ?`)
    .all(pdfPath) as { product_slug: string }[];
  const slugs = Array.from(new Set(rows.map(r => r.product_slug)));
  return { matched: slugs.length > 0, productSlugs: slugs };
}
