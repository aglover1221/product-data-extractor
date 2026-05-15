/**
 * Anthropic SDK wrappers for the studio pipeline.
 *
 * Three concerns:
 *   1. Building cache-friendly prompts (cache_control on the schema bundle + skill).
 *   2. Submitting and polling Anthropic Batch jobs (extraction fan-out).
 *   3. Cost accounting — pre-submission estimate + post-completion actual.
 *
 * Pricing constants are for Claude Opus 4.7 as of 2026-05. Update when models
 * change. Batch API charges 50% of standard everywhere; the helper bakes that in.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

let _client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set; cannot call Anthropic API");
  }
  if (_client) return _client;
  _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

// ----------------------------------------------------------------------------
// Cache control helper
// ----------------------------------------------------------------------------

export type CacheTtl = "5m" | "1h";

/**
 * Returns a cache_control marker block. Attach to the LAST content block of a
 * cacheable prefix; everything up to and including that block is cached together.
 * Use 1h TTL for batch extraction — 5min default expires inside batch processing.
 */
export function cacheControl(ttl: CacheTtl = "1h") {
  return ttl === "1h"
    ? ({ type: "ephemeral", ttl: "1h" } as const)
    : ({ type: "ephemeral" } as const);
}

// ----------------------------------------------------------------------------
// Pricing — Claude Opus 4.7 (per MTok)
// ----------------------------------------------------------------------------

const PRICING_OPUS = {
  inputPerMTok: 15.0,
  outputPerMTok: 75.0,
  cacheWrite5mPerMTok: 18.75, // 1.25 × input
  cacheWrite1hPerMTok: 30.0, // 2 × input
  cacheReadPerMTok: 1.5, // 0.1 × input
};

export interface CostInputs {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cacheTtl?: CacheTtl;
  batch?: boolean;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  totalUsd: number;
}

export function calcCost({
  inputTokens,
  outputTokens,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
  cacheTtl = "1h",
  batch = false,
}: CostInputs): CostBreakdown {
  const p = PRICING_OPUS;
  const writeRate =
    cacheTtl === "1h" ? p.cacheWrite1hPerMTok : p.cacheWrite5mPerMTok;
  const discount = batch ? 0.5 : 1.0;

  const toUsd = (tokens: number, ratePerMTok: number) =>
    (tokens / 1_000_000) * ratePerMTok * discount;

  const inputUsd = toUsd(inputTokens, p.inputPerMTok);
  const outputUsd = toUsd(outputTokens, p.outputPerMTok);
  const cacheWriteUsd = toUsd(cacheCreationTokens, writeRate);
  const cacheReadUsd = toUsd(cacheReadTokens, p.cacheReadPerMTok);

  return {
    inputUsd,
    outputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    totalUsd: inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd,
  };
}

/**
 * Rough word→token ratio for English-with-HTML-tables Reducto sidecars.
 * Real tokenization varies; use as an estimate only. Anthropic's count_tokens
 * API is the precise option but adds a round-trip per estimate.
 */
export function estimateTokensFromText(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.4);
}

// ----------------------------------------------------------------------------
// Batch API wrappers
// ----------------------------------------------------------------------------

export interface BatchRequest {
  custom_id: string;
  params: Anthropic.Messages.MessageCreateParamsNonStreaming;
}

export async function submitBatch(
  requests: BatchRequest[]
): Promise<{ batchId: string; requestCount: number }> {
  const client = getAnthropic();
  const batch = await client.messages.batches.create({ requests });
  return { batchId: batch.id, requestCount: requests.length };
}

export async function getBatchStatus(batchId: string) {
  const client = getAnthropic();
  return client.messages.batches.retrieve(batchId);
}

/**
 * Streams batch results as parsed JSONL. Anthropic's SDK exposes results as
 * an async iterable when the batch is `ended`; caller iterates and writes
 * outputs to filesystem + DB rows.
 */
export async function* streamBatchResults(batchId: string) {
  const client = getAnthropic();
  const stream = await client.messages.batches.results(batchId);
  for await (const entry of stream) {
    yield entry;
  }
}

// ----------------------------------------------------------------------------
// Single-message wrapper (interactive — schema-gen, spot-fix)
// ----------------------------------------------------------------------------

export async function messagesCreate(
  params: Anthropic.Messages.MessageCreateParamsNonStreaming
): Promise<Anthropic.Messages.Message> {
  const client = getAnthropic();
  return client.messages.create(params);
}
