-- Durable + race-safe job queue.
--
-- Adds the columns and indexes the new queue.ts needs:
--   * lease_expires_at   — a worker holds the job until this ISO timestamp;
--                          past that, the claim query reclaims it.
--   * idempotency_key    — caller-supplied de-dupe key; partial-unique while
--                          a prior job with the same key is pending/running.
--   * max_attempts       — per-row retry budget; failJob() bumps a job to
--                          'dead' once attempts >= max_attempts.
--
-- The `status` column now also takes the value 'dead' (terminal, with
-- last_error captured). No CHECK constraint to widen — SQLite never had one.
--
-- Upgrade behavior for an existing DB:
--   * Columns are added with safe defaults (NULL / 5).
--   * Any jobs currently sitting in status='running' from a previous worker
--     boot pre-date the lease system, so they have no way to be reclaimed.
--     We bounce them back to 'pending' (and clear started_at) so the new
--     worker picks them up cleanly on first poll. Completed/failed rows are
--     untouched.

ALTER TABLE jobs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE jobs ADD COLUMN idempotency_key  TEXT;
ALTER TABLE jobs ADD COLUMN max_attempts     INTEGER NOT NULL DEFAULT 5;

-- Recover orphaned in-flight jobs from before this migration.
UPDATE jobs
   SET status = 'pending',
       started_at = NULL
 WHERE status = 'running';

-- The claim query filters on (status, next_run_at) for pending picks AND on
-- (status, lease_expires_at) for expired-lease reclaims. The existing
-- idx_jobs_status_next covers the first; we add a second composite for the
-- reclaim path. SQLite's planner happily uses either depending on the OR
-- branch.
CREATE INDEX IF NOT EXISTS idx_jobs_status_lease
  ON jobs(status, lease_expires_at);

-- Partial unique index: a given idempotency_key may only have one job in a
-- non-terminal state at a time. Once that job moves to completed/failed/dead
-- the key is free again — that's intentional, so a downstream retry with the
-- same key after a permanent failure can re-enqueue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_active
  ON jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('pending', 'running');
