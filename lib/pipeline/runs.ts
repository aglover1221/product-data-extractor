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
