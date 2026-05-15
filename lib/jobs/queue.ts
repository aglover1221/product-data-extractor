/**
 * Minimal job queue backed by SQLite. Workers poll `jobs` table; handlers
 * are dispatched by `type`. Re-enqueue by inserting a new row with `next_run_at`
 * set to a future timestamp (poll loop respects it).
 */
import { getStudioDb } from "@/lib/db/client";

export interface JobRow {
  id: number;
  type: string;
  payload_json: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  last_error: string | null;
  next_run_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function enqueueJob<T>(type: string, payload: T, runAt?: Date): number {
  const db = getStudioDb();
  const stmt = db.prepare(
    `INSERT INTO jobs (type, payload_json, status, attempts, next_run_at, created_at)
     VALUES (?, ?, 'pending', 0, ?, ?)`
  );
  const info = stmt.run(
    type,
    JSON.stringify(payload),
    runAt ? runAt.toISOString() : null,
    new Date().toISOString()
  );
  return Number(info.lastInsertRowid);
}

export function claimNextJob(): JobRow | null {
  const db = getStudioDb();
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT * FROM jobs
       WHERE status = 'pending'
         AND (next_run_at IS NULL OR next_run_at <= ?)
       ORDER BY id ASC
       LIMIT 1`
    )
    .get(now) as JobRow | undefined;
  if (!row) return null;
  db.prepare(
    `UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1 WHERE id = ?`
  ).run(now, row.id);
  return row;
}

export function completeJob(id: number): void {
  const db = getStudioDb();
  db.prepare(
    `UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), id);
}

export function failJob(id: number, error: string): void {
  const db = getStudioDb();
  db.prepare(
    `UPDATE jobs SET status = 'failed', last_error = ?, completed_at = ? WHERE id = ?`
  ).run(error, new Date().toISOString(), id);
}

/**
 * Reschedule a job by setting it back to pending with a future next_run_at.
 * Used when a poll handler hasn't seen the upstream finish yet.
 */
export function rescheduleJob(id: number, runAt: Date): void {
  const db = getStudioDb();
  db.prepare(
    `UPDATE jobs SET status = 'pending', next_run_at = ?, started_at = NULL WHERE id = ?`
  ).run(runAt.toISOString(), id);
}
