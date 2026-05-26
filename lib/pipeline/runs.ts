/**
 * Query + insert helpers for `extraction_runs` and `extraction_results`.
 *
 * Raw better-sqlite3 prepared statements; mirrors the style of lib/jobs/queue.ts.
 * The worker (handlers/anthropic-batch.ts) writes the terminal status; these
 * helpers cover the read paths and the initial insert at submission time.
 */
import { getStudioDb } from "@/lib/db/client";

export type ExtractionRunStatus =
  | "queued"
  | "submitted"
  | "processing"
  | "completed"
  | "completed-with-errors"
  | "failed";

export type ExtractionResultStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface ExtractionRunRow {
  id: number;
  batch_id: string | null;
  schema_version_id: number | null;
  schema_name: string;
  schema_version: string;
  product_set_json: string;
  status: ExtractionRunStatus;
  cost_estimate_usd: number | null;
  cost_actual_usd: number | null;
  request_count: number | null;
  success_count: number;
  fail_count: number;
  submitted_at: string;
  completed_at: string | null;
  notes: string | null;
}

export interface ExtractionResultRow {
  id: number;
  run_id: number;
  product_slug: string;
  status: ExtractionResultStatus;
  output_path: string | null;
  error_message: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_usd: number | null;
  started_at: string | null;
  completed_at: string | null;
}

/** All runs newest-first for the run-history list. */
export function listRuns(): ExtractionRunRow[] {
  const db = getStudioDb();
  return db
    .prepare(
      `SELECT * FROM extraction_runs ORDER BY datetime(submitted_at) DESC, id DESC`
    )
    .all() as ExtractionRunRow[];
}

export function getRun(id: number): ExtractionRunRow | null {
  const db = getStudioDb();
  const row = db
    .prepare(`SELECT * FROM extraction_runs WHERE id = ?`)
    .get(id) as ExtractionRunRow | undefined;
  return row ?? null;
}

export function listRunResults(runId: number): ExtractionResultRow[] {
  const db = getStudioDb();
  return db
    .prepare(
      `SELECT * FROM extraction_results WHERE run_id = ? ORDER BY product_slug ASC`
    )
    .all(runId) as ExtractionResultRow[];
}

export interface InsertRunInput {
  batchId: string | null;
  schemaName: string;
  schemaVersion: string;
  productSlugs: string[];
  status: ExtractionRunStatus;
  costEstimateUsd: number;
  requestCount: number;
  schemaVersionId?: number | null;
  notes?: string;
}

export function insertRun(input: InsertRunInput): number {
  const db = getStudioDb();
  const submittedAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO extraction_runs
         (batch_id, schema_version_id, schema_name, schema_version,
          product_set_json, status, cost_estimate_usd, request_count,
          submitted_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.batchId,
      input.schemaVersionId ?? null,
      input.schemaName,
      input.schemaVersion,
      JSON.stringify(input.productSlugs),
      input.status,
      input.costEstimateUsd,
      input.requestCount,
      submittedAt,
      input.notes ?? null
    );
  return Number(info.lastInsertRowid);
}

export function insertResult(
  runId: number,
  productSlug: string,
  status: ExtractionResultStatus = "queued"
): number {
  const db = getStudioDb();
  const startedAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO extraction_results (run_id, product_slug, status, started_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(runId, productSlug, status, startedAt);
  return Number(info.lastInsertRowid);
}

// ----------------------------------------------------------------------------
// Idempotent state transitions for extraction_results
//
// `claimNextJob` re-claims rows whose `lease_expires_at <= now`, so worker
// handlers may be invoked any number of times for the same job payload.
// Each transition below is guarded by a `status IN (…)` WHERE clause; the
// returned `changes` count tells the caller whether the row was actually
// moved (true) or already in a terminal state (false).
//
// Without these guards, a reclaim that overlaps the streaming loop in
// worker/handlers/anthropic-batch.ts rewrites prior-attempt rows — turning
// a previously `completed` row back into `running` and overwriting its
// audit-trail timestamps and token counts.
// ----------------------------------------------------------------------------

export function getResultByRunAndSlug(
  runId: number,
  productSlug: string
): ExtractionResultRow | null {
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT * FROM extraction_results WHERE run_id = ? AND product_slug = ?`
    )
    .get(runId, productSlug) as ExtractionResultRow | undefined;
  return row ?? null;
}

/**
 * Transition queued → running, stamping started_at with the real work-start
 * time (not the submission time recorded by insertResult).
 *
 * Returns true iff the row was actually moved. A row already in `running`,
 * `completed`, or `failed` is left untouched and false is returned — the
 * caller must treat that as "another worker already started or finished it".
 */
export function markResultRunningIdempotent(resultId: number): boolean {
  const db = getStudioDb();
  const info = db
    .prepare(
      `UPDATE extraction_results
          SET status = 'running',
              started_at = ?
        WHERE id = ?
          AND status = 'queued'`
    )
    .run(new Date().toISOString(), resultId);
  return info.changes > 0;
}

export interface ResultCompletionPayload {
  outputPath: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/**
 * Transition queued/running → completed. Persists per-result cost so the
 * run-level aggregate is derivable from a single SQL query rather than from
 * an in-memory accumulator that resets on every reclaim.
 *
 * Returns false if the row is already in a terminal state — the caller's
 * recomputed values are silently discarded, which is the safe behaviour
 * under reclaim (the first attempt's values are the source of truth).
 */
export function markResultCompletedIdempotent(
  resultId: number,
  payload: ResultCompletionPayload
): boolean {
  const db = getStudioDb();
  const info = db
    .prepare(
      `UPDATE extraction_results
          SET status = 'completed',
              output_path = ?,
              input_tokens = ?,
              output_tokens = ?,
              cache_read_tokens = ?,
              cache_creation_tokens = ?,
              cost_usd = ?,
              error_message = NULL,
              completed_at = ?
        WHERE id = ?
          AND status IN ('queued', 'running')`
    )
    .run(
      payload.outputPath,
      payload.inputTokens,
      payload.outputTokens,
      payload.cacheReadTokens,
      payload.cacheCreationTokens,
      payload.costUsd,
      new Date().toISOString(),
      resultId
    );
  return info.changes > 0;
}

/**
 * Transition queued/running → failed. A row already in `completed` is
 * NEVER moved back to `failed` by this helper — a transient parse error on
 * the second attempt of a reclaim must not erase the first attempt's good
 * output.
 */
export function markResultFailedIdempotent(
  resultId: number,
  error: string
): boolean {
  const db = getStudioDb();
  const info = db
    .prepare(
      `UPDATE extraction_results
          SET status = 'failed',
              error_message = ?,
              completed_at = ?
        WHERE id = ?
          AND status IN ('queued', 'running')`
    )
    .run(error, new Date().toISOString(), resultId);
  return info.changes > 0;
}

export interface RunAggregateTotals {
  successCount: number;
  failCount: number;
  pendingCount: number;
  costActualUsd: number;
}

/**
 * Single source of truth for run-level aggregates. Reads directly from
 * `extraction_results` so the answer is identical across reclaim attempts.
 *
 * SQLite supports the FILTER syntax since 3.30; the CASE-based equivalent
 * below works on older builds too without relying on COUNT(*) FILTER.
 */
export function aggregateRunTotalsFromResults(
  runId: number
): RunAggregateTotals {
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS fail_count,
         SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS pending_count,
         COALESCE(SUM(cost_usd), 0) AS cost_actual_usd
         FROM extraction_results
        WHERE run_id = ?`
    )
    .get(runId) as
    | {
        success_count: number | null;
        fail_count: number | null;
        pending_count: number | null;
        cost_actual_usd: number | null;
      }
    | undefined;
  return {
    successCount: row?.success_count ?? 0,
    failCount: row?.fail_count ?? 0,
    pendingCount: row?.pending_count ?? 0,
    costActualUsd: row?.cost_actual_usd ?? 0,
  };
}

/**
 * Finalize an extraction_run by deriving its terminal status, counts, and
 * cost from the DB. Idempotent: re-running the aggregate after another
 * reclaim attempt lands the same numbers.
 *
 * Status policy:
 *   - any pending → status stays 'processing' (the loop hasn't finished)
 *   - all completed → 'completed'
 *   - some failed   → 'completed-with-errors'
 *   - all failed    → 'failed'
 */
export function finalizeRunFromResults(runId: number): {
  status: ExtractionRunStatus;
  totals: RunAggregateTotals;
} {
  const db = getStudioDb();
  const totals = aggregateRunTotalsFromResults(runId);
  let nextStatus: ExtractionRunStatus;
  if (totals.pendingCount > 0) {
    nextStatus = "processing";
  } else if (totals.successCount === 0 && totals.failCount > 0) {
    nextStatus = "failed";
  } else if (totals.failCount > 0) {
    nextStatus = "completed-with-errors";
  } else {
    nextStatus = "completed";
  }
  const completedAt = totals.pendingCount === 0
    ? new Date().toISOString()
    : null;
  db.prepare(
    `UPDATE extraction_runs
        SET status = ?,
            cost_actual_usd = ?,
            success_count = ?,
            fail_count = ?,
            completed_at = COALESCE(?, completed_at)
      WHERE id = ?`
  ).run(
    nextStatus,
    totals.costActualUsd,
    totals.successCount,
    totals.failCount,
    completedAt,
    runId
  );
  return { status: nextStatus, totals };
}

/**
 * Latest run/job status snapshot for SSE consumers. Cheap to call; bounded
 * size — caps run rows + jobs.
 */
export interface JobStreamSnapshot {
  ts: string;
  runs: Array<{
    id: number;
    schema_name: string;
    schema_version: string;
    status: ExtractionRunStatus;
    success_count: number;
    fail_count: number;
    request_count: number | null;
    cost_actual_usd: number | null;
    submitted_at: string;
    completed_at: string | null;
  }>;
  jobs: Array<{
    id: number;
    type: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
  }>;
}

export function getJobStreamSnapshot(limit = 25): JobStreamSnapshot {
  const db = getStudioDb();
  const runs = db
    .prepare(
      `SELECT id, schema_name, schema_version, status, success_count, fail_count,
              request_count, cost_actual_usd, submitted_at, completed_at
         FROM extraction_runs
        ORDER BY datetime(submitted_at) DESC, id DESC
        LIMIT ?`
    )
    .all(limit) as JobStreamSnapshot["runs"];
  const jobs = db
    .prepare(
      `SELECT id, type, status, attempts, last_error, created_at
         FROM jobs
        ORDER BY id DESC
        LIMIT ?`
    )
    .all(limit) as JobStreamSnapshot["jobs"];
  return { ts: new Date().toISOString(), runs, jobs };
}
