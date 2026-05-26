/**
 * Polls an Anthropic Batch job. When the batch ends, streams results, writes
 * extraction.json files to the data tree, and updates extraction_results rows.
 *
 * Job payload:
 *   { runId: number, batchId: string }
 *
 * Re-enqueues itself with a 30s delay if the batch is still processing.
 */
import path from "node:path";
import { env } from "@/lib/env";
import { getStudioDb } from "@/lib/db/client";
import { rescheduleJob } from "@/lib/jobs/queue";
import {
  getBatchStatus,
  streamBatchResults,
  calcCost,
} from "@/lib/integrations/anthropic";
import {
  parseExtractionJson,
  writeExtractionJson,
  resolveBatchProductDir,
} from "@/lib/pipeline/extract";

export interface AnthropicBatchPayload {
  runId: number;
  batchId: string;
}

const POLL_INTERVAL_MS = 30_000;

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
  let successCount = 0;
  let failCount = 0;
  let totalCostUsd = 0;

  for await (const entry of streamBatchResults(batchId)) {
    const batchCustomId = entry.custom_id;
    const resultRow = db
      .prepare(
        `SELECT id, output_path FROM extraction_results WHERE run_id = ? AND product_slug = ?`
      )
      .get(runId, batchCustomId) as
      | { id: number; output_path: string | null }
      | undefined;

    if (!resultRow) {
      console.warn(
        `[batch-poll] no extraction_results row for run=${runId} custom_id=${batchCustomId}; skipping`
      );
      continue;
    }

    if (entry.result.type === "succeeded") {
      const message = entry.result.message;
      const textBlock = message.content.find(
        (b: any) => b.type === "text"
      ) as { type: "text"; text: string } | undefined;
      if (!textBlock) {
        markFailed(resultRow.id, "no text content in response");
        failCount++;
        continue;
      }
      try {
        const parsed = parseExtractionJson(textBlock.text);
        const productDir = resolveBatchProductDir(batchCustomId);
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
        totalCostUsd += cost.totalUsd;
        db.prepare(
          `UPDATE extraction_results SET
             status = 'completed',
             output_path = ?,
             input_tokens = ?,
             output_tokens = ?,
             cache_read_tokens = ?,
             cache_creation_tokens = ?,
             completed_at = ?
           WHERE id = ?`
        ).run(
          path.relative(env.PRODUCT_MCP_DATA_DIR, outPath),
          usage.input_tokens,
          usage.output_tokens,
          usage.cache_read_input_tokens ?? 0,
          usage.cache_creation_input_tokens ?? 0,
          new Date().toISOString(),
          resultRow.id
        );
        successCount++;
      } catch (err) {
        markFailed(resultRow.id, (err as Error).message);
        failCount++;
      }
    } else if (entry.result.type === "errored") {
      markFailed(resultRow.id, JSON.stringify(entry.result.error));
      failCount++;
    } else {
      // expired or canceled
      markFailed(resultRow.id, `result type: ${entry.result.type}`);
      failCount++;
    }
  }

  const finalStatus = failCount === 0 ? "completed" : "completed-with-errors";
  db.prepare(
    `UPDATE extraction_runs SET
       status = ?,
       cost_actual_usd = ?,
       success_count = ?,
       fail_count = ?,
       completed_at = ?
     WHERE id = ?`
  ).run(
    finalStatus,
    totalCostUsd,
    successCount,
    failCount,
    new Date().toISOString(),
    runId
  );

  console.log(
    `[batch-poll] run=${runId} ended: ${successCount} succeeded, ${failCount} failed, cost=$${totalCostUsd.toFixed(4)}`
  );
}

function markFailed(resultId: number, error: string): void {
  const db = getStudioDb();
  db.prepare(
    `UPDATE extraction_results SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`
  ).run(error, new Date().toISOString(), resultId);
}
