/**
 * POST /api/pipeline/extract
 *
 * Submit an extraction batch.
 *
 * Body:
 *   {
 *     category: string,            // e.g. "server"
 *     products: string[],          // slugs (last path segment) — must resolve under PRODUCT_MCP_DATA_DIR
 *     schema_version?: string,     // currently informational; W3 will plumb real selection
 *     dryRun?: boolean             // skip submission, return estimate only
 *   }
 *
 * Behaviour:
 *   1. Validate inputs.
 *   2. Resolve each product slug to a ProductContext.
 *   3. Estimate aggregate cost; refuse if > MAX_RUN_USD (or if dryRun, return).
 *   4. Submit one Anthropic Batch covering every product.
 *   5. Insert extraction_runs + extraction_results rows; enqueue poll job.
 *
 * Returns:
 *   { runId, batchId, costEstimateUsd, requestCount }       on submit
 *   { dryRun: true, costEstimateUsd, perProduct, ... }       on dryRun / over-cap
 */
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ensureStudioSchema } from "@/lib/db/client";
import {
  loadProductContext,
  submitBatchForCategory,
} from "@/lib/pipeline/extract";
import { estimateBatchCost } from "@/lib/pipeline/cost-estimate";
import {
  insertRun,
  insertResult,
} from "@/lib/pipeline/runs";
import { enqueueJob } from "@/lib/jobs/queue";
import { findProductBySlug } from "@/lib/pipeline/products-on-disk";
import type { AnthropicBatchPayload } from "@/worker/handlers/anthropic-batch";

export const dynamic = "force-dynamic";

interface ExtractRequestBody {
  category?: string;
  products?: string[];
  schema_version?: string;
  dryRun?: boolean;
}

export async function POST(req: NextRequest) {
  ensureStudioSchema();

  let body: ExtractRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const category = (body.category ?? "").trim();
  const productsInput = Array.isArray(body.products) ? body.products : [];
  const schemaVersion = (body.schema_version ?? "wave-2-snapshot").trim();
  const dryRun = body.dryRun === true;

  if (!category) {
    return NextResponse.json({ error: "category required" }, { status: 400 });
  }
  if (productsInput.length === 0) {
    return NextResponse.json(
      { error: "products[] must be non-empty" },
      { status: 400 }
    );
  }

  // Resolve each product. Accept either a slug-only entry (we lookup the
  // category-rooted relative path) or a full relative path like "server/dell/poweredge/r770".
  const resolvedRels: string[] = [];
  const errors: string[] = [];
  for (const ref of productsInput) {
    const cleaned = ref.trim().replace(/^\/+|\/+$/g, "");
    if (!cleaned) continue;
    if (cleaned.includes("/")) {
      resolvedRels.push(cleaned);
      continue;
    }
    // Slug-only: look it up on disk.
    const found = findProductBySlug(cleaned);
    if (!found) {
      errors.push(`unknown product slug: ${cleaned}`);
      continue;
    }
    if (found.category !== category) {
      errors.push(
        `slug ${cleaned} resolves to category ${found.category}, not ${category}`
      );
      continue;
    }
    resolvedRels.push(found.productPathRel);
  }
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "product resolution failed", details: errors },
      { status: 400 }
    );
  }
  if (resolvedRels.length === 0) {
    return NextResponse.json(
      { error: "no resolvable products" },
      { status: 400 }
    );
  }

  // Load contexts. Surfaces missing manifest / missing sidecars early.
  const contexts = [];
  for (const rel of resolvedRels) {
    try {
      contexts.push(loadProductContext(rel));
    } catch (err) {
      return NextResponse.json(
        {
          error: `failed to load product context for ${rel}: ${
            (err as Error).message
          }`,
        },
        { status: 400 }
      );
    }
  }

  // Sanity: every product must resolve to the same category we were told.
  const mismatched = contexts.filter(c => {
    const top = c.categoryKey.split(":")[0];
    return top !== category;
  });
  if (mismatched.length > 0) {
    return NextResponse.json(
      {
        error: "products span multiple categories — submit one category at a time",
        details: mismatched.map(c => `${c.slug}: ${c.categoryKey}`),
      },
      { status: 400 }
    );
  }

  const estimate = estimateBatchCost(contexts, { batch: true });

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      costEstimateUsd: estimate.totalUsd,
      coldUsd: estimate.coldUsd,
      warmUsdEach: estimate.warmUsdEach,
      productCount: estimate.productCount,
      perProduct: estimate.perProduct,
      maxRunUsd: env.MAX_RUN_USD,
    });
  }

  if (estimate.totalUsd > env.MAX_RUN_USD) {
    return NextResponse.json(
      {
        error: `estimated cost $${estimate.totalUsd.toFixed(
          2
        )} exceeds MAX_RUN_USD $${env.MAX_RUN_USD.toFixed(2)}`,
        costEstimateUsd: estimate.totalUsd,
        maxRunUsd: env.MAX_RUN_USD,
      },
      { status: 400 }
    );
  }

  // Submit Batch + persist run.
  let batchId: string;
  let requestCount: number;
  try {
    const result = await submitBatchForCategory(contexts);
    batchId = result.batchId;
    requestCount = result.requestCount;
  } catch (err) {
    return NextResponse.json(
      { error: `Anthropic batch submit failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const productSlugs = contexts.map(c => c.slug);
  const runId = insertRun({
    batchId,
    schemaName: contexts[0].categoryKey,
    schemaVersion,
    productSlugs,
    status: "submitted",
    costEstimateUsd: estimate.totalUsd,
    requestCount,
  });
  for (const slug of productSlugs) {
    insertResult(runId, slug, "queued");
  }

  const payload: AnthropicBatchPayload = { runId, batchId };
  enqueueJob("anthropic-batch-poll", payload, {
    idempotencyKey: `anthropic-batch-poll:${batchId}`,
  });

  return NextResponse.json({
    runId,
    batchId,
    costEstimateUsd: estimate.totalUsd,
    requestCount,
  });
}
