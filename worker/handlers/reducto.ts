/**
 * Polls a Reducto parse job. When the upstream job ends, fetches the parsed
 * payload, writes the .md sidecar adjacent to the PDF, downloads image crops,
 * runs validation, and updates the parse_runs row.
 *
 * Job payload:
 *   { parseRunId: number, reductoJobId: string }
 *
 * Re-enqueues itself with a 30s delay if Reducto is still working.
 *
 * Idempotency: if the parse_run already has status='completed' and an
 * output_md_path on disk, this handler short-circuits and lets the worker
 * mark the job complete.
 */
import { getStudioDb } from "@/lib/db/client";
import { rescheduleJob } from "@/lib/jobs/queue";
import {
  getJobStatus,
  mapReductoStatus,
} from "@/lib/integrations/reducto";
import { processParseResult } from "@/lib/pipeline/parse";

export interface ReductoPollPayload {
  parseRunId: number;
  reductoJobId: string;
}

const POLL_INTERVAL_MS = 30_000;

export async function handleReductoPoll(
  jobId: number,
  payload: ReductoPollPayload
): Promise<void> {
  const { parseRunId, reductoJobId } = payload;
  const db = getStudioDb();

  // Idempotency check — short-circuit on already-completed runs.
  const existing = db
    .prepare(
      `SELECT status, output_md_path FROM parse_runs WHERE id = ?`
    )
    .get(parseRunId) as
    | { status: string; output_md_path: string | null }
    | undefined;
  if (!existing) {
    console.warn(
      `[reducto-poll] parse_runs ${parseRunId} not found; nothing to do`
    );
    return;
  }
  if (existing.status === "completed" && existing.output_md_path) {
    console.log(
      `[reducto-poll] parse_runs ${parseRunId} already completed; no-op`
    );
    return;
  }

  let meta;
  try {
    meta = await getJobStatus(reductoJobId);
  } catch (err) {
    // Don't fail the studio job on a transient Reducto outage — reschedule.
    console.warn(
      `[reducto-poll] status lookup transient error (${(err as Error).message}); reschedule in ${POLL_INTERVAL_MS / 1000}s`
    );
    rescheduleJob(jobId, new Date(Date.now() + POLL_INTERVAL_MS));
    return;
  }
  const mapped = mapReductoStatus(meta.status);

  if (mapped === "running" || mapped === "queued") {
    db.prepare(
      `UPDATE parse_runs SET status = 'running' WHERE id = ?`
    ).run(parseRunId);
    rescheduleJob(jobId, new Date(Date.now() + POLL_INTERVAL_MS));
    console.log(
      `[reducto-poll] run=${parseRunId} reducto-job=${reductoJobId} status=${meta.status} — reschedule in ${POLL_INTERVAL_MS / 1000}s`
    );
    return;
  }

  if (mapped === "failed") {
    const errMsg = `Reducto job ${reductoJobId} failed: ${meta.status}`;
    db.prepare(
      `UPDATE parse_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`
    ).run(errMsg, new Date().toISOString(), parseRunId);
    console.error(`[reducto-poll] run=${parseRunId} ${errMsg}`);
    return;
  }

  // Completed.
  try {
    const { outputMdPath, warnings } = await processParseResult({ parseRunId });
    console.log(
      `[reducto-poll] run=${parseRunId} completed → ${outputMdPath} (warnings: ${warnings.length})`
    );
  } catch (err) {
    const msg = (err as Error).message;
    db.prepare(
      `UPDATE parse_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`
    ).run(msg, new Date().toISOString(), parseRunId);
    console.error(`[reducto-poll] run=${parseRunId} processing failed: ${msg}`);
    throw err;
  }
}
