/**
 * Durable, race-safe job queue backed by SQLite.
 *
 * Design notes:
 *   - Claim is one atomic `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING *`
 *     so two workers polling the same DB can never grab the same row.
 *     Both writes happen inside a single statement under SQLite's write lock.
 *   - Every claim sets `lease_expires_at = now + leaseMs`. The claim query
 *     also picks up rows whose lease has expired (worker crashed mid-job),
 *     so no separate reaper process is needed. Handlers that genuinely
 *     need more time can call `extendLease(jobId, ms)`.
 *   - `failJob` retries with exponential backoff until `max_attempts` is
 *     reached, at which point the row moves to status='dead' with the
 *     final error preserved in `last_error`. Dead rows are never claimed
 *     again.
 *   - `enqueueJob` accepts an optional `idempotencyKey`. While a job with
 *     that key is pending/running, re-enqueues are a no-op that return the
 *     existing job id — deduplication is enforced by a partial unique index,
 *     so this is race-safe across concurrent callers too.
 */
import type Database from "better-sqlite3";
import { getStudioDb } from "@/lib/db/client";

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "dead";

export interface JobRow {
  id: number;
  type: string;
  payload_json: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_run_at: string | null;
  lease_expires_at: string | null;
  idempotency_key: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface EnqueueOptions {
  /** When to first eligible-to-run. Default: now. */
  runAt?: Date;
  /**
   * De-duplication key. While a prior job with this key is pending or
   * running, this call is a no-op and returns the existing job id.
   * Cleared semantically once that job reaches a terminal state.
   */
  idempotencyKey?: string;
  /** Override the retry budget (default 5). */
  maxAttempts?: number;
}

export interface ClaimOptions {
  /** How long the claimer holds the job before it can be re-claimed by
   *  another worker. Default 10 minutes — long enough to cover the
   *  Anthropic-batch result streaming + extraction write-out path. */
  leaseMs?: number;
}

const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_CAP_MS = 10 * 60 * 1000;

/**
 * Insert a job, or — if `idempotencyKey` collides with an already-active
 * job — return that job's id without inserting.
 *
 * The unique constraint is enforced by a partial index on
 * `(idempotency_key)` filtered to `status IN ('pending','running')`. So
 * "active" here means a worker hasn't yet finalised the prior job.
 */
export function enqueueJob<T>(
  type: string,
  payload: T,
  opts: EnqueueOptions = {},
): number {
  const db = getStudioDb();
  const now = new Date().toISOString();
  const runAt = opts.runAt ? opts.runAt.toISOString() : null;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const idempotencyKey = opts.idempotencyKey ?? null;

  try {
    const info = db
      .prepare(
        `INSERT INTO jobs
           (type, payload_json, status, attempts, max_attempts,
            next_run_at, idempotency_key, created_at)
         VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)`,
      )
      .run(type, JSON.stringify(payload), maxAttempts, runAt, idempotencyKey, now);
    return Number(info.lastInsertRowid);
  } catch (err) {
    if (idempotencyKey && isUniqueViolation(err)) {
      const existing = db
        .prepare(
          `SELECT id FROM jobs
            WHERE idempotency_key = ?
              AND status IN ('pending','running')
            LIMIT 1`,
        )
        .get(idempotencyKey) as { id: number } | undefined;
      if (existing) return existing.id;
    }
    throw err;
  }
}

/**
 * Atomically pick the next eligible job and mark it running.
 *
 * "Eligible" is either:
 *   1. status='pending' AND (next_run_at IS NULL OR next_run_at <= now), or
 *   2. status='running' AND lease_expires_at <= now  (crashed-worker reclaim).
 *
 * Both branches share the same UPDATE — case 2 effectively counts as a fresh
 * attempt, so `attempts` increments and `started_at` is refreshed.
 */
export function claimNextJob(opts: ClaimOptions = {}): JobRow | null {
  const db = getStudioDb();
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();

  const row = db
    .prepare(
      `UPDATE jobs
          SET status = 'running',
              started_at = ?,
              attempts = attempts + 1,
              lease_expires_at = ?
        WHERE id = (
          SELECT id FROM jobs
           WHERE
             (status = 'pending'
              AND (next_run_at IS NULL OR next_run_at <= ?))
             OR
             (status = 'running'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at <= ?)
           ORDER BY id ASC
           LIMIT 1
        )
        RETURNING *`,
    )
    .get(nowIso, leaseExpiresAt, nowIso, nowIso) as JobRow | undefined;
  return row ?? null;
}

export function completeJob(id: number): void {
  const db = getStudioDb();
  db.prepare(
    `UPDATE jobs
        SET status = 'completed',
            completed_at = ?,
            lease_expires_at = NULL
      WHERE id = ?`,
  ).run(new Date().toISOString(), id);
}

/**
 * Record a failed attempt.
 *
 * If the job still has retry budget, it returns to status='pending' with an
 * exponential-backoff `next_run_at`. Once `attempts >= max_attempts` the row
 * moves to terminal status='dead' — the dead-letter state. `last_error` is
 * always overwritten with the most recent failure.
 *
 * Returns the resulting status so the worker can log it. The status is
 * derived from `attempts` already incremented by `claimNextJob`, so callers
 * don't need to track retry counts themselves.
 */
export function failJob(id: number, error: string): JobStatus {
  const db = getStudioDb();
  const row = db
    .prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`)
    .get(id) as { attempts: number; max_attempts: number } | undefined;
  if (!row) return "failed";

  if (row.attempts >= row.max_attempts) {
    db.prepare(
      `UPDATE jobs
          SET status = 'dead',
              last_error = ?,
              completed_at = ?,
              lease_expires_at = NULL
        WHERE id = ?`,
    ).run(error, new Date().toISOString(), id);
    return "dead";
  }

  const nextRunAt = new Date(Date.now() + backoffMs(row.attempts)).toISOString();
  db.prepare(
    `UPDATE jobs
        SET status = 'pending',
            last_error = ?,
            next_run_at = ?,
            started_at = NULL,
            lease_expires_at = NULL
      WHERE id = ?`,
  ).run(error, nextRunAt, id);
  return "pending";
}

/**
 * Reschedule a still-progressing job (handler saw "upstream not done yet").
 * Returns it to the pending pool with a future `next_run_at` and releases
 * the lease so a different worker may pick it up.
 */
export function rescheduleJob(id: number, runAt: Date): void {
  const db = getStudioDb();
  db.prepare(
    `UPDATE jobs
        SET status = 'pending',
            next_run_at = ?,
            started_at = NULL,
            lease_expires_at = NULL
      WHERE id = ?`,
  ).run(runAt.toISOString(), id);
}

/**
 * Push a running job's lease out by `ms` from now. For handlers that know
 * they're entering a long phase and want to avoid being reclaimed mid-work.
 */
export function extendLease(id: number, ms: number): void {
  const db = getStudioDb();
  const newExpiry = new Date(Date.now() + ms).toISOString();
  db.prepare(
    `UPDATE jobs SET lease_expires_at = ? WHERE id = ? AND status = 'running'`,
  ).run(newExpiry, id);
}

/** Read-only fetch — handy for tests and the worker's status check. */
export function getJob(id: number): JobRow | null {
  const db: Database.Database = getStudioDb();
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
    | JobRow
    | undefined;
  return row ?? null;
}

function backoffMs(attemptNumber: number): number {
  // attemptNumber is the count AFTER the just-failed attempt
  // (claim incremented it). attempt 1 → BASE, attempt 2 → 2×BASE, capped.
  const ms = BACKOFF_BASE_MS * 2 ** Math.max(0, attemptNumber - 1);
  return Math.min(ms, BACKOFF_CAP_MS);
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT";
}
