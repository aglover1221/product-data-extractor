/**
 * Usage / spend / cache aggregations for the /usage dashboard.
 *
 * The orchestrator already records cost per extraction run (`cost_actual_usd`),
 * per-result token counts (`extraction_results.{input,output,cache_*}_tokens`),
 * and per-spotfix cost (`spotfix_runs.cost_usd`). Nothing in the app surfaces
 * these aggregates today — this module is the read layer the dashboard reads.
 *
 * Conventions:
 *   - `cost_actual_usd` on a completed extraction_runs row is authoritative.
 *     For per-product breakdowns the column is too coarse (run-level only),
 *     so we recompute per-row spend from token counts via calcCost().
 *   - cacheTtl is not stored on the run row. We default to "1h" — matching
 *     buildExtractionPrompt's default in lib/pipeline/cost-estimate.ts.
 *   - batch flag is inferred from `batch_id != null`.
 *   - Dates use `date(submitted_at)` for grouping; SQLite's date() returns
 *     YYYY-MM-DD which is timezone-naive but consistent within the DB.
 */
import { getStudioDb } from "@/lib/db/client";
import { calcCost } from "@/lib/integrations/anthropic";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface DailySpendPoint {
  /** YYYY-MM-DD */
  day: string;
  extractionUsd: number;
  spotfixUsd: number;
  totalUsd: number;
  runCount: number;
}

export interface TopProductRow {
  productSlug: string;
  resultCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Recomputed from per-result tokens via calcCost. */
  costUsd: number;
}

export interface SchemaRollupRow {
  schemaName: string;
  runCount: number;
  productCount: number;
  /** Sum of cost_actual_usd from extraction_runs (NULLs ignored). */
  actualUsd: number;
  /** Sum of cost_estimate_usd from extraction_runs (NULLs ignored). */
  estimateUsd: number;
  /** actual - estimate when both present, else null. */
  driftUsd: number | null;
}

export interface CacheEfficiency {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  /** cache_read / (input + cache_read + cache_creation). 0..1. */
  hitRate: number;
  /** Recomputed spend (sanity-check against extraction_runs.cost_actual_usd sum). */
  recomputedUsd: number;
}

export interface DriftSample {
  runId: number;
  schemaName: string;
  estimateUsd: number;
  actualUsd: number;
  /** actual - estimate. Positive = under-estimate. */
  deltaUsd: number;
  /** delta / estimate, 0 if estimate is 0. */
  ratio: number;
  submittedAt: string;
}

export interface UsageHeadline {
  totalSpendUsd: number;
  extractionUsd: number;
  spotfixUsd: number;
  runsAllTime: number;
  runsLast30d: number;
  resultsAllTime: number;
  windowDays: number;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

interface ResultJoinRow {
  product_slug: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  batch_id: string | null;
}

function rowCost(r: ResultJoinRow): number {
  return calcCost({
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    cacheReadTokens: r.cache_read_tokens ?? 0,
    cacheCreationTokens: r.cache_creation_tokens ?? 0,
    cacheTtl: "1h",
    batch: r.batch_id !== null,
  }).totalUsd;
}

function safeDiv(num: number, denom: number): number {
  return denom === 0 ? 0 : num / denom;
}

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------

/**
 * Headline numbers for the dashboard top strip. One pass, cheap.
 */
export function getHeadline(windowDays = 30): UsageHeadline {
  const db = getStudioDb();

  const ext = db
    .prepare(
      `SELECT
         COALESCE(SUM(cost_actual_usd), 0) AS total,
         COUNT(*) AS runs,
         SUM(CASE WHEN datetime(submitted_at) >= datetime('now', ?) THEN 1 ELSE 0 END) AS recentRuns
       FROM extraction_runs`
    )
    .get(`-${windowDays} days`) as {
      total: number;
      runs: number;
      recentRuns: number | null;
    };

  const spot = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spotfix_runs`)
    .get() as { total: number };

  const results = db
    .prepare(`SELECT COUNT(*) AS n FROM extraction_results`)
    .get() as { n: number };

  return {
    totalSpendUsd: ext.total + spot.total,
    extractionUsd: ext.total,
    spotfixUsd: spot.total,
    runsAllTime: ext.runs,
    runsLast30d: ext.recentRuns ?? 0,
    resultsAllTime: results.n,
    windowDays,
  };
}

/**
 * Daily spend over the trailing window, oldest → newest, including zero-spend
 * days so the sparkline isn't gappy.
 */
export function getDailySpend(windowDays = 30): DailySpendPoint[] {
  const db = getStudioDb();

  const extRows = db
    .prepare(
      `SELECT date(submitted_at) AS day,
              COALESCE(SUM(cost_actual_usd), 0) AS usd,
              COUNT(*) AS runs
         FROM extraction_runs
        WHERE datetime(submitted_at) >= datetime('now', ?)
        GROUP BY day`
    )
    .all(`-${windowDays} days`) as Array<{ day: string; usd: number; runs: number }>;

  const spotRows = db
    .prepare(
      `SELECT date(started_at) AS day,
              COALESCE(SUM(cost_usd), 0) AS usd
         FROM spotfix_runs
        WHERE datetime(started_at) >= datetime('now', ?)
        GROUP BY day`
    )
    .all(`-${windowDays} days`) as Array<{ day: string; usd: number }>;

  const byDay = new Map<string, DailySpendPoint>();
  // Seed every day in the window so sparkline doesn't skip empty days.
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, {
      day: key,
      extractionUsd: 0,
      spotfixUsd: 0,
      totalUsd: 0,
      runCount: 0,
    });
  }
  for (const r of extRows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    p.extractionUsd = r.usd;
    p.runCount = r.runs;
    p.totalUsd += r.usd;
  }
  for (const r of spotRows) {
    const p = byDay.get(r.day);
    if (!p) continue;
    p.spotfixUsd = r.usd;
    p.totalUsd += r.usd;
  }
  return [...byDay.values()];
}

/**
 * Top products by recomputed cost (tokens × prevailing rate).
 * Pulls every completed result row and aggregates in JS — fine at this scale;
 * a single fan-out run is ~hundreds of rows, all-time is small. If/when this
 * grows, push the SUMs into SQL and recompute per group instead of per row.
 */
export function getTopProducts(limit = 10): TopProductRow[] {
  const db = getStudioDb();
  const rows = db
    .prepare(
      `SELECT r.product_slug,
              r.input_tokens, r.output_tokens,
              r.cache_read_tokens, r.cache_creation_tokens,
              run.batch_id
         FROM extraction_results r
         JOIN extraction_runs run ON run.id = r.run_id
        WHERE r.status = 'completed'`
    )
    .all() as ResultJoinRow[];

  const acc = new Map<string, TopProductRow>();
  for (const row of rows) {
    const cur = acc.get(row.product_slug) ?? {
      productSlug: row.product_slug,
      resultCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    };
    cur.resultCount += 1;
    cur.inputTokens += row.input_tokens ?? 0;
    cur.outputTokens += row.output_tokens ?? 0;
    cur.cacheReadTokens += row.cache_read_tokens ?? 0;
    cur.cacheCreationTokens += row.cache_creation_tokens ?? 0;
    cur.costUsd += rowCost(row);
    acc.set(row.product_slug, cur);
  }
  return [...acc.values()]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, limit);
}

/**
 * Per-schema rollup. cost_actual_usd / cost_estimate_usd are run-level columns
 * already populated by the worker, so we just SUM them in SQL.
 */
export function getSchemaRollup(): SchemaRollupRow[] {
  const db = getStudioDb();
  const rows = db
    .prepare(
      `SELECT schema_name                          AS schemaName,
              COUNT(*)                             AS runCount,
              COALESCE(SUM(request_count), 0)      AS productCount,
              COALESCE(SUM(cost_actual_usd), 0)    AS actualUsd,
              COALESCE(SUM(cost_estimate_usd), 0)  AS estimateUsd,
              SUM(CASE WHEN cost_actual_usd IS NOT NULL
                        AND cost_estimate_usd IS NOT NULL
                       THEN 1 ELSE 0 END)          AS bothCount
         FROM extraction_runs
        GROUP BY schema_name
        ORDER BY actualUsd DESC`
    )
    .all() as Array<{
      schemaName: string;
      runCount: number;
      productCount: number;
      actualUsd: number;
      estimateUsd: number;
      bothCount: number;
    }>;

  return rows.map((r) => ({
    schemaName: r.schemaName,
    runCount: r.runCount,
    productCount: r.productCount,
    actualUsd: r.actualUsd,
    estimateUsd: r.estimateUsd,
    driftUsd: r.bothCount > 0 ? r.actualUsd - r.estimateUsd : null,
  }));
}

/**
 * Global cache hit rate across all completed extraction results.
 * Spotfix runs aren't included — they don't use the cache the same way.
 */
export function getCacheEfficiency(): CacheEfficiency {
  const db = getStudioDb();
  const rows = db
    .prepare(
      `SELECT r.input_tokens, r.output_tokens,
              r.cache_read_tokens, r.cache_creation_tokens,
              run.batch_id
         FROM extraction_results r
         JOIN extraction_runs run ON run.id = r.run_id
        WHERE r.status = 'completed'`
    )
    .all() as ResultJoinRow[];

  let input = 0,
    output = 0,
    cacheRead = 0,
    cacheCreate = 0,
    usd = 0;
  for (const r of rows) {
    input += r.input_tokens ?? 0;
    output += r.output_tokens ?? 0;
    cacheRead += r.cache_read_tokens ?? 0;
    cacheCreate += r.cache_creation_tokens ?? 0;
    usd += rowCost(r);
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreate,
    hitRate: safeDiv(cacheRead, input + cacheRead + cacheCreate),
    recomputedUsd: usd,
  };
}

/**
 * Per-run estimator drift, newest first. Only runs with both estimate + actual.
 */
export function getEstimateDrift(limit = 50): DriftSample[] {
  const db = getStudioDb();
  const rows = db
    .prepare(
      `SELECT id, schema_name, cost_estimate_usd, cost_actual_usd, submitted_at
         FROM extraction_runs
        WHERE cost_estimate_usd IS NOT NULL
          AND cost_actual_usd IS NOT NULL
        ORDER BY datetime(submitted_at) DESC, id DESC
        LIMIT ?`
    )
    .all(limit) as Array<{
      id: number;
      schema_name: string;
      cost_estimate_usd: number;
      cost_actual_usd: number;
      submitted_at: string;
    }>;

  return rows.map((r) => ({
    runId: r.id,
    schemaName: r.schema_name,
    estimateUsd: r.cost_estimate_usd,
    actualUsd: r.cost_actual_usd,
    deltaUsd: r.cost_actual_usd - r.cost_estimate_usd,
    ratio: safeDiv(r.cost_actual_usd - r.cost_estimate_usd, r.cost_estimate_usd),
    submittedAt: r.submitted_at,
  }));
}

// ----------------------------------------------------------------------------
// CSV export
// ----------------------------------------------------------------------------

export interface ExportRow {
  runId: number;
  submittedAt: string;
  completedAt: string | null;
  schemaName: string;
  schemaVersion: string;
  status: string;
  mode: "batch" | "sync";
  requestCount: number;
  successCount: number;
  failCount: number;
  estimateUsd: number | null;
  actualUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
}

/**
 * Per-run rows for CSV. Pulls token aggregates from extraction_results in a
 * single grouped query, joined to the run row.
 */
export function getExportRows(): ExportRow[] {
  const db = getStudioDb();
  const rows = db
    .prepare(
      `SELECT run.id                              AS runId,
              run.submitted_at                    AS submittedAt,
              run.completed_at                    AS completedAt,
              run.schema_name                     AS schemaName,
              run.schema_version                  AS schemaVersion,
              run.status                          AS status,
              run.batch_id                        AS batchId,
              run.request_count                   AS requestCount,
              run.success_count                   AS successCount,
              run.fail_count                      AS failCount,
              run.cost_estimate_usd               AS estimateUsd,
              run.cost_actual_usd                 AS actualUsd,
              COALESCE(SUM(r.input_tokens), 0)        AS inputTokens,
              COALESCE(SUM(r.output_tokens), 0)       AS outputTokens,
              COALESCE(SUM(r.cache_read_tokens), 0)   AS cacheReadTokens,
              COALESCE(SUM(r.cache_creation_tokens),0)AS cacheCreationTokens
         FROM extraction_runs run
         LEFT JOIN extraction_results r
                ON r.run_id = run.id
               AND r.status = 'completed'
        GROUP BY run.id
        ORDER BY datetime(run.submitted_at) DESC, run.id DESC`
    )
    .all() as Array<{
      runId: number;
      submittedAt: string;
      completedAt: string | null;
      schemaName: string;
      schemaVersion: string;
      status: string;
      batchId: string | null;
      requestCount: number | null;
      successCount: number;
      failCount: number;
      estimateUsd: number | null;
      actualUsd: number | null;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }>;

  return rows.map((r) => ({
    runId: r.runId,
    submittedAt: r.submittedAt,
    completedAt: r.completedAt,
    schemaName: r.schemaName,
    schemaVersion: r.schemaVersion,
    status: r.status,
    mode: r.batchId ? "batch" : "sync",
    requestCount: r.requestCount ?? 0,
    successCount: r.successCount,
    failCount: r.failCount,
    estimateUsd: r.estimateUsd,
    actualUsd: r.actualUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheCreationTokens: r.cacheCreationTokens,
    cacheHitRate: safeDiv(
      r.cacheReadTokens,
      r.inputTokens + r.cacheReadTokens + r.cacheCreationTokens
    ),
  }));
}

const CSV_HEADER = [
  "run_id",
  "submitted_at",
  "completed_at",
  "schema_name",
  "schema_version",
  "status",
  "mode",
  "request_count",
  "success_count",
  "fail_count",
  "cost_estimate_usd",
  "cost_actual_usd",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "cache_hit_rate",
] as const;

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote when the cell contains a comma, quote, or newline. Escape inner quotes.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize ExportRow[] to a CSV string. RFC-4180-ish: CRLF line endings, quoted as needed. */
export function rowsToCsv(rows: ExportRow[]): string {
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.runId,
        r.submittedAt,
        r.completedAt ?? "",
        r.schemaName,
        r.schemaVersion,
        r.status,
        r.mode,
        r.requestCount,
        r.successCount,
        r.failCount,
        r.estimateUsd ?? "",
        r.actualUsd ?? "",
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.cacheCreationTokens,
        r.cacheHitRate.toFixed(4),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
