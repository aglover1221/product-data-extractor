/**
 * CLI smoke test for the extraction pipeline.
 *
 *   npm run extract-one -- --product server/dell/poweredge/r770
 *   npm run extract-one -- --product server/dell/poweredge/r770 --mode batch
 *   npm run extract-one -- --product server/dell/poweredge/r770 --dry-run
 *
 * Modes:
 *   sync  (default) — single Messages API call. Writes extraction.json on success.
 *                     Slower per-call than batch, but immediate feedback for dev.
 *   batch          — submit one product as a single Batch request, log batch id.
 *                     Worker (`npm run worker`) polls and writes the result.
 *
 * Either mode prints token estimate, cost estimate, and (for sync) actual usage.
 */
import "@/lib/env";
import path from "node:path";
import { env } from "@/lib/env";
import { ensureStudioSchema, getStudioDb } from "@/lib/db/client";
import {
  loadProductContext,
  buildExtractionPrompt,
  submitOneSync,
  submitBatchForCategory,
  parseExtractionJson,
  writeExtractionJson,
} from "@/lib/pipeline/extract";
import { calcCost } from "@/lib/integrations/anthropic";
import { enqueueJob } from "@/lib/jobs/queue";
import type { AnthropicBatchPayload } from "../worker/handlers/anthropic-batch";

interface Args {
  product: string;
  mode: "sync" | "batch";
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Partial<Args> = { mode: "sync", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--product") out.product = argv[++i];
    else if (a === "--mode") out.mode = argv[++i] as "sync" | "batch";
    else if (a === "--dry-run") out.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.product) {
    throw new Error(
      "missing --product <path> (e.g. server/dell/poweredge/r770)"
    );
  }
  if (out.mode !== "sync" && out.mode !== "batch") {
    throw new Error(`--mode must be sync|batch (got ${out.mode})`);
  }
  return out as Args;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

async function main() {
  const args = parseArgs();
  ensureStudioSchema();

  console.log(`[extract-one] product=${args.product} mode=${args.mode}${args.dryRun ? " (dry-run)" : ""}`);

  const ctx = loadProductContext(args.product);
  console.log(`[extract-one] resolved category=${ctx.categoryKey}, slug=${ctx.slug}`);
  console.log(`[extract-one] manifest sources: ${ctx.manifest.length}`);

  const built = buildExtractionPrompt(ctx);
  const est = built.estimate;
  console.log(`[extract-one] estimate:`);
  console.log(`  system prompt:    ${est.systemTokens.toLocaleString()} tok`);
  console.log(`  schema bundle:    ${est.schemaTokens.toLocaleString()} tok (cached after first call)`);
  console.log(`  product context:  ${est.productContextTokens.toLocaleString()} tok`);
  console.log(`  source MDs:       ${est.sourceTokens.toLocaleString()} tok`);
  console.log(`  total input:      ${est.totalInputTokens.toLocaleString()} tok`);

  // Cold-cache cost (first call in a category)
  const coldCost = calcCost({
    inputTokens: est.productContextTokens + est.sourceTokens,
    outputTokens: 8000, // rough output estimate
    cacheCreationTokens: est.systemTokens + est.schemaTokens,
    cacheReadTokens: 0,
    cacheTtl: "1h",
    batch: args.mode === "batch",
  });
  // Warm-cache cost (2nd...Nth call in a category fan-out)
  const warmCost = calcCost({
    inputTokens: est.productContextTokens + est.sourceTokens,
    outputTokens: 8000,
    cacheCreationTokens: 0,
    cacheReadTokens: est.systemTokens + est.schemaTokens,
    cacheTtl: "1h",
    batch: args.mode === "batch",
  });
  console.log(`[extract-one] cost estimate (cold cache, first call): ${fmtUsd(coldCost.totalUsd)}`);
  console.log(`[extract-one] cost estimate (warm cache, subsequent): ${fmtUsd(warmCost.totalUsd)}`);

  if (args.dryRun) {
    console.log(`[extract-one] dry-run — exiting before submission`);
    return;
  }

  if (args.mode === "sync") {
    console.log(`[extract-one] submitting via Messages API...`);
    const t0 = Date.now();
    const { message } = await submitOneSync(ctx);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const usage = message.usage;
    const actualCost = calcCost({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheTtl: "1h",
      batch: false,
    });
    console.log(`[extract-one] response in ${elapsed}s; usage:`);
    console.log(`  input:           ${usage.input_tokens.toLocaleString()} tok`);
    console.log(`  output:          ${usage.output_tokens.toLocaleString()} tok`);
    console.log(`  cache read:      ${(usage.cache_read_input_tokens ?? 0).toLocaleString()} tok`);
    console.log(`  cache creation:  ${(usage.cache_creation_input_tokens ?? 0).toLocaleString()} tok`);
    console.log(`  actual cost:     ${fmtUsd(actualCost.totalUsd)}`);

    const textBlock = message.content.find(b => b.type === "text") as { type: "text"; text: string } | undefined;
    if (!textBlock) {
      console.error(`[extract-one] no text block in response`);
      process.exit(1);
    }
    const parsed = parseExtractionJson(textBlock.text);
    const outPath = writeExtractionJson(ctx.productDir, parsed);
    console.log(`[extract-one] wrote ${path.relative(env.PRODUCT_MCP_DATA_DIR, outPath)}`);
    return;
  }

  // batch mode
  console.log(`[extract-one] submitting via Batch API...`);
  const db = getStudioDb();
  const submittedAt = new Date().toISOString();
  const runStmt = db.prepare(
    `INSERT INTO extraction_runs
       (batch_id, schema_name, schema_version, product_set_json, status, cost_estimate_usd, request_count, submitted_at)
     VALUES (?, ?, ?, ?, 'submitted', ?, 1, ?)`
  );

  const { batchId, requestCount } = await submitBatchForCategory([ctx]);
  const runInfo = runStmt.run(
    batchId,
    ctx.categoryKey,
    "wave-1-snapshot",
    JSON.stringify([ctx.slug]),
    coldCost.totalUsd,
    submittedAt
  );
  const runId = Number(runInfo.lastInsertRowid);
  db.prepare(
    `INSERT INTO extraction_results (run_id, product_slug, status, started_at) VALUES (?, ?, 'queued', ?)`
  ).run(runId, ctx.slug, submittedAt);

  const payload: AnthropicBatchPayload = { runId, batchId };
  const jobId = enqueueJob("anthropic-batch-poll", payload);
  console.log(`[extract-one] batch submitted:`);
  console.log(`  batch_id:  ${batchId}`);
  console.log(`  run_id:    ${runId}`);
  console.log(`  job_id:    ${jobId}`);
  console.log(`  requests:  ${requestCount}`);
  console.log(`[extract-one] start the worker to poll: npm run worker`);
}

main().catch(err => {
  console.error("[extract-one] failed:", err);
  process.exit(1);
});
