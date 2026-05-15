/**
 * Pre-submission cost estimator. Mirrors the cost lines printed by
 * scripts/extract-one.ts. Used by:
 *   - the extract form, to surface a USD estimate before submit
 *   - the extract API route, to enforce the MAX_RUN_USD cap
 *
 * Model: the FIRST product in a category fan-out pays cache-write cost on the
 * (system + schema) prefix; the remaining N-1 products pay cache-read cost on
 * the same prefix. Per-product source MDs + product context are uncached input.
 */
import {
  buildExtractionPrompt,
  type ProductContext,
} from "@/lib/pipeline/extract";
import { calcCost, type CacheTtl } from "@/lib/integrations/anthropic";

const OUTPUT_TOKENS_PER_PRODUCT = 8000;

export interface PerProductEstimate {
  slug: string;
  totalInputTokens: number;
  systemTokens: number;
  schemaTokens: number;
  productContextTokens: number;
  sourceTokens: number;
}

export interface BatchCostEstimate {
  perProduct: PerProductEstimate[];
  /** Cold-cache call (one per category fan-out) — pays cache_creation. */
  coldUsd: number;
  /** Warm-cache call (every other call) — pays cache_read. */
  warmUsdEach: number;
  /** Sum across all products — what we compare to MAX_RUN_USD. */
  totalUsd: number;
  productCount: number;
  cacheTtl: CacheTtl;
  batch: boolean;
  outputTokensPerProduct: number;
}

export interface EstimateOptions {
  cacheTtl?: CacheTtl;
  batch?: boolean;
  outputTokensPerProduct?: number;
}

/**
 * Build prompts for each product (token estimates only — no API call) and
 * compute the aggregate USD figure.
 *
 * Estimate budget: cold (1×) + warm × (N-1).
 *   cold = cache_creation(system + schema) + uncached(product_context + sources)
 *   warm = cache_read(system + schema)     + uncached(product_context + sources)
 */
export function estimateBatchCost(
  contexts: ProductContext[],
  options: EstimateOptions = {}
): BatchCostEstimate {
  const cacheTtl = options.cacheTtl ?? "1h";
  const batch = options.batch ?? true;
  const outputTokens =
    options.outputTokensPerProduct ?? OUTPUT_TOKENS_PER_PRODUCT;

  const perProduct: PerProductEstimate[] = [];
  let totalUsd = 0;
  // Cold-cache numbers (used for the FIRST product in a category fan-out).
  let coldUsd = 0;
  // Warm-cache per-call number — only the LAST product's tokens, but
  // realistically the schema bundle is identical across products in a category
  // so per-call cost is essentially flat. We surface the warm estimate from
  // the median product to give the user a realistic single-call number.
  let warmUsdEach = 0;

  contexts.forEach((ctx, idx) => {
    const built = buildExtractionPrompt(ctx, { cacheTtl });
    const est = built.estimate;
    perProduct.push({
      slug: ctx.slug,
      totalInputTokens: est.totalInputTokens,
      systemTokens: est.systemTokens,
      schemaTokens: est.schemaTokens,
      productContextTokens: est.productContextTokens,
      sourceTokens: est.sourceTokens,
    });

    const cachedPrefixTokens = est.systemTokens + est.schemaTokens;
    const uncachedTokens = est.productContextTokens + est.sourceTokens;

    const cost = calcCost({
      inputTokens: uncachedTokens,
      outputTokens,
      cacheCreationTokens: idx === 0 ? cachedPrefixTokens : 0,
      cacheReadTokens: idx === 0 ? 0 : cachedPrefixTokens,
      cacheTtl,
      batch,
    });
    totalUsd += cost.totalUsd;
    if (idx === 0) coldUsd = cost.totalUsd;
    if (idx === Math.min(1, contexts.length - 1)) warmUsdEach = cost.totalUsd;
  });

  // If there's only one product, there's no warm call — surface the cold cost.
  if (contexts.length === 1) warmUsdEach = coldUsd;

  return {
    perProduct,
    coldUsd,
    warmUsdEach,
    totalUsd,
    productCount: contexts.length,
    cacheTtl,
    batch,
    outputTokensPerProduct: outputTokens,
  };
}
