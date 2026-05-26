/**
 * Polls an Anthropic Batch job. When the batch ends, streams results, writes
 * extraction.json files to the data tree, and updates extraction_results rows.
 *
 * Job payload:
 *   { runId: number, batchId: string }
 *
 * Re-enqueues itself with a 30s delay if the batch is still processing.
 *
 * Idempotency contract — REQUIRED reading before changing this file.
 * ----------------------------------------------------------------------------
 * `claimNextJob` (lib/jobs/queue.ts) re-claims any job whose lease expired,
 * so this handler may be invoked any number of times for the same payload.
 * Every state-changing step is therefore guarded:
 *
 *   1. Per-result rows are SELECTed first; rows already in a terminal state
 *      (`completed` / `failed`) are skipped — the prior attempt's output is
 *      the source of truth, never re-written.
 *   2. The streaming loop calls `extendLease` every LEASE_RENEW_EVERY_N_RESULTS
 *      entries so a long batch can't get pre-empted halfway through.
 *   3. `extraction.json` is written through `atomicWriteJson` (tmp + rename) —
 *      a crash mid-write leaves the prior file intact.
 *   4. Run-level aggregates are derived from a single SQL query over
 *      `extraction_results` at the end of each attempt (see
 *      `finalizeRunFromResults`), so the totals are stable across reclaim
 *      cycles. In-memory counters would otherwise reset to 0 per invocation
 *      and overwrite the cumulative truth.
 *   5. A `custom_id` that doesn't match any extraction_results row is
 *      synthesised as a failed row so `success + fail == request_count` is
 *      always preserved.
 */
import path from "node:path";
import { env } from "@/lib/env";
import { getStudioDb } from "@/lib/db/client";
import { extendLease, rescheduleJob } from "@/lib/jobs/queue";
import {
  getBatchStatus,
  streamBatchResults,
  calcCost,
} from "@/lib/integrations/anthropic";
import {
  parseExtractionJson,
  writeExtractionJson,
} from "@/lib/pipeline/extract";
import {
  finalizeRunFromResults,
  getResultByRunAndSlug,
  insertResult,
  markResultCompletedIdempotent,
  markResultFailedIdempotent,
  markResultRunningIdempotent,
} from "@/lib/pipeline/runs";

export interface AnthropicBatchPayload {
  runId: number;
  batchId: string;
}

const POLL_INTERVAL_MS = 30_000;
const LEASE_RENEW_EVERY_N_RESULTS = 10;
const LEASE_RENEW_MS = 10 * 60 * 1000;

export async function handleAnthropicBatchPoll(
  jobId: number,
  payload: AnthropicBatchPayload
): Promise<void> {
  const { runId, batchId } = payload;
  const db = getStudioDb();
  const batch = await getBatchStatus(batchId);

  if (batch.processing_status !== "ended") {
    rescheduleJob(jobId, new Date(Date.now() + POLL_INTERVAL_MS));
    db.prepare(
      `UPDATE extraction_runs SET status = 'processing' WHERE id = ?`
    ).run(runId);
    console.log(
      `[batch-poll] run=${runId} batch=${batchId} status=${batch.processing_status} — reschedule in ${POLL_INTERVAL_MS / 1000}s`
    );
    return;
  }

  // Batch ended. Stream and process each result row.
  let processed = 0;
  let skippedAlreadyTerminal = 0;
  let orphans = 0;

  for await (const entry of streamBatchResults(batchId)) {
    const productSlug = entry.custom_id;

    if (processed > 0 && processed % LEASE_RENEW_EVERY_N_RESULTS === 0) {
      extendLease(jobId, LEASE_RENEW_MS);
    }
    processed++;

    const resultRow = getResultByRunAndSlug(runId, productSlug);
    if (!resultRow) {
      // Orphan custom_id — no extraction_results row was inserted for this
      // product at submission time (schema drift, manual DB edit, or a
      // submission/poll mismatch). Synthesise a failed row so the run's
      // request_count math always balances.
      const orphanId = insertResult(runId, productSlug, "queued");
      markResultFailedIdempotent(
        orphanId,
        `no result row at submission; custom_id=${productSlug} mismatch`
      );
      orphans++;
      console.warn(
        `[batch-poll] orphan custom_id=${productSlug} for run=${runId}; recorded as failed`
      );
      continue;
    }

    if (resultRow.status === "completed" || resultRow.status === "failed") {
      // Prior-attempt result already terminalised — leave it alone.
      skippedAlreadyTerminal++;
      continue;
    }

    // Move queued → running so the row reflects when the real work started
    // (insertResult stamped started_at with the submission time, which the
    // /usage dashboard misreports as work-duration without this).
    markResultRunningIdempotent(resultRow.id);

    if (entry.result.type === "succeeded") {
      processSucceeded(entry.result.message, resultRow.id);
    } else if (entry.result.type === "errored") {
      markResultFailedIdempotent(
        resultRow.id,
        JSON.stringify(entry.result.error)
      );
    } else {
      // expired or canceled
      markResultFailedIdempotent(
        resultRow.id,
        `result type: ${entry.result.type}`
      );
    }
  }

  // Derive the run's terminal status, counts, and cost from the DB. This is
  // the only place the run-level totals are set; in-memory accumulators are
  // gone on purpose — they would reset to 0 every reclaim attempt and
  // overwrite the cumulative truth.
  const { status, totals } = finalizeRunFromResults(runId);

  console.log(
    `[batch-poll] run=${runId} ended status=${status}: ` +
      `${totals.successCount} succeeded, ${totals.failCount} failed, ` +
      `cost=$${totals.costActualUsd.toFixed(4)} ` +
      `(processed=${processed} skipped-terminal=${skippedAlreadyTerminal} orphans=${orphans})`
  );
}

function processSucceeded(message: any, resultId: number): void {
  const productSlug = resolveProductSlugFromResult(resultId);
  const textBlock = message.content.find(
    (b: any) => b.type === "text"
  ) as { type: "text"; text: string } | undefined;
  if (!textBlock) {
    markResultFailedIdempotent(resultId, "no text content in response");
    return;
  }
  try {
    const parsed = parseExtractionJson(textBlock.text);
    const productDir = path.resolve(env.PRODUCT_MCP_DATA_DIR, productSlug);
    const outPath = writeExtractionJson(productDir, parsed);
    const usage = message.usage;
    const cost = calcCost({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheTtl: "1h",
      batch: true,
    });
    markResultCompletedIdempotent(resultId, {
      outputPath: path.relative(env.PRODUCT_MCP_DATA_DIR, outPath),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd: cost.totalUsd,
    });
  } catch (err) {
    markResultFailedIdempotent(resultId, (err as Error).message);
  }
}

function resolveProductSlugFromResult(resultId: number): string {
  const db = getStudioDb();
  const row = db
    .prepare(`SELECT product_slug FROM extraction_results WHERE id = ?`)
    .get(resultId) as { product_slug: string } | undefined;
  if (!row) throw new Error(`extraction_results ${resultId} not found`);
  return row.product_slug;
}
