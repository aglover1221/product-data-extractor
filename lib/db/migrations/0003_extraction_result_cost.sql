-- Per-result cost auditability and idempotent worker handlers.
--
-- Adds `cost_usd` to extraction_results so the run-level aggregate
-- (`extraction_runs.cost_actual_usd`) can be derived from a single SQL query
-- over the source-of-truth per-result rows, instead of an in-memory
-- accumulator inside the batch-poll handler.
--
-- Why this is needed:
--   * `claimNextJob` re-claims jobs whose `lease_expires_at <= now` (durable
--     queue, PR #5). A long batch can outlive its 10-minute lease, so the
--     handler must be safe to re-invoke.
--   * The existing handler keeps `successCount / failCount / totalCostUsd` as
--     local variables and writes them into `extraction_runs` after the loop.
--     Those locals reset to 0 on every reclaim, so the final aggregate reflects
--     only the *last* attempt's totals — prior-attempt cost is lost.
--   * With per-result cost persisted, `finalizeRunFromResults(runId)` can run a
--     deterministic SQL aggregate at the end of every attempt and always land
--     the same authoritative totals on `extraction_runs`, regardless of how
--     many reclaim cycles happened.
--
-- Upgrade behavior for an existing DB:
--   * The new column is nullable and defaults to NULL. Pre-existing rows have
--     no per-result cost record; the run-level `cost_actual_usd` already on
--     `extraction_runs` is kept as the historical truth — the aggregate query
--     uses COALESCE so older runs aren't penalised by missing per-row cost.

ALTER TABLE extraction_results ADD COLUMN cost_usd REAL;

-- The aggregate query groups by run_id and filters by status. idx_results_run
-- already exists from 0001_init.sql, so the group-by is cheap. We add a
-- (run_id, status) composite to keep the FILTER-style COUNTs leaf-only.
CREATE INDEX IF NOT EXISTS idx_results_run_status
  ON extraction_results(run_id, status);
