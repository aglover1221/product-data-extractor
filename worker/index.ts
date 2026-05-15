/**
 * Studio worker — long-running sidecar that processes background jobs.
 *
 *   npm run worker
 *
 * Polls the `jobs` table every POLL_INTERVAL_MS, dispatches by type,
 * marks completion. Idempotent handlers; jobs re-enqueue themselves on
 * upstream-still-processing.
 */
import "@/lib/env"; // load + validate env up front
import { ensureStudioSchema } from "@/lib/db/client";
import {
  claimNextJob,
  completeJob,
  failJob,
  type JobRow,
} from "@/lib/jobs/queue";
import {
  handleAnthropicBatchPoll,
  type AnthropicBatchPayload,
} from "./handlers/anthropic-batch";
import {
  handleReductoPoll,
  type ReductoPollPayload,
} from "./handlers/reducto";

const POLL_INTERVAL_MS = 5_000;

ensureStudioSchema();

console.log(`[worker] started; polling every ${POLL_INTERVAL_MS}ms`);

let stopping = false;
process.on("SIGINT", () => {
  console.log("[worker] SIGINT — draining current job and stopping");
  stopping = true;
});

async function dispatch(job: JobRow): Promise<void> {
  switch (job.type) {
    case "anthropic-batch-poll": {
      const payload = JSON.parse(job.payload_json) as AnthropicBatchPayload;
      await handleAnthropicBatchPoll(job.id, payload);
      // anthropic-batch-poll handler reschedules itself if upstream not done;
      // it does NOT call completeJob in that case. We complete here only if
      // the job is no longer pending (handler did the terminal write).
      return;
    }
    case "reducto-poll": {
      const payload = JSON.parse(job.payload_json) as ReductoPollPayload;
      await handleReductoPoll(job.id, payload);
      // Same convention as anthropic-batch-poll: handler reschedules when the
      // upstream job is still pending. We mark complete iff status went terminal.
      return;
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function loop() {
  while (!stopping) {
    const job = claimNextJob();
    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    console.log(`[worker] claimed job=${job.id} type=${job.type} attempt=${job.attempts}`);
    try {
      await dispatch(job);
      // For non-rescheduling handlers, mark complete. Reschedulers leave the
      // status as 'pending' (rescheduleJob did that), so the UPDATE here is
      // a no-op for them.
      const db = (await import("@/lib/db/client")).getStudioDb();
      const current = db
        .prepare(`SELECT status FROM jobs WHERE id = ?`)
        .get(job.id) as { status: string } | undefined;
      if (current && current.status === "running") {
        completeJob(job.id);
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[worker] job=${job.id} failed: ${msg}`);
      failJob(job.id, msg);
    }
  }
  console.log("[worker] stopped");
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

loop().catch(err => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
