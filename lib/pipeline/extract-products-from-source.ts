/**
 * Extract products from a line- or category-level source.
 *
 * After Reducto parses a family-shared spec sheet (e.g. N3200-ON spec sheet
 * covers 9 SKUs, Connectrix DS-7700B family covers 3), this skill reads the
 * `.md` sidecar and asks an LLM to enumerate every individual product
 * mentioned. The user approves the proposed list; on commit we create
 * product MD skeletons under `{category}/{vendor}/{line}/{slug}/{slug}.md`.
 *
 * Two-step flow (mirrors the discover phase):
 *   1. previewProductsFromSource(sourcePath) — LLM scan, returns proposals.
 *   2. commitProductsFromSource(sourcePath, slugs) — writes MD skeletons.
 */
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import {
  cacheControl,
  estimateTokensFromText,
  messagesCreate,
} from "@/lib/integrations/anthropic";
import { writeProductMdSkeleton } from "@/lib/pipeline/product-md-skel";

const PROMPTS_DIR = path.resolve(process.cwd(), "lib/prompts");
const DATA_DIR = path.resolve(env.PRODUCT_MCP_DATA_DIR);

// ----------------------------------------------------------------------------
// Source-path → owning product line
// ----------------------------------------------------------------------------

export interface SourceLineContext {
  category: string;
  vendor: string;
  productLine: string;
  /** Absolute on-disk path to the sidecar. */
  sidecarAbs: string;
  /** The same path, manifest-form (relative to PRODUCT_MCP_DATA_DIR). */
  sidecarRel: string;
}

/**
 * Resolve a sidecar path (relative to PRODUCT_MCP_DATA_DIR) to its owning
 * (category, vendor, productLine). Only line-scope and category-scope
 * sidecars are valid inputs. Product-scope (covers a single SKU) is rejected
 * because there's nothing to enumerate.
 *
 * Layout per project conventions:
 *   {category}/{vendor}/{line}/source/*.md   ← line scope
 *   {category}/{vendor}/source/*.md          ← category scope
 *   {category}/{vendor}/{line}/{slug}/source/*.md  ← product scope (rejected)
 */
export function resolveSourceLineContext(
  sourcePathRel: string
): SourceLineContext | null {
  const parts = sourcePathRel.split("/");
  const sourceIdx = parts.lastIndexOf("source");
  if (sourceIdx === -1) return null;
  const prefix = parts.slice(0, sourceIdx);
  const sidecarAbs = path.resolve(DATA_DIR, sourcePathRel);
  if (!fs.existsSync(sidecarAbs)) return null;

  if (prefix.length === 3) {
    // Line scope
    const [category, vendor, productLine] = prefix;
    return {
      category,
      vendor,
      productLine,
      sidecarAbs,
      sidecarRel: sourcePathRel,
    };
  }
  if (prefix.length === 2) {
    // Category scope — productLine unknown, caller must supply
    return null;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Prompt builder
// ----------------------------------------------------------------------------

let _systemPromptCache: string | null = null;
function loadSystemPrompt(): string {
  if (_systemPromptCache) return _systemPromptCache;
  const fp = path.join(PROMPTS_DIR, "extract-products-from-source.md");
  _systemPromptCache = fs.readFileSync(fp, "utf8");
  return _systemPromptCache;
}

const SOURCE_BODY_MAX_CHARS = 120_000; // ~30k tokens; covers most family spec sheets

interface BuildPromptArgs {
  ctx: SourceLineContext;
  sourceBody: string;
}

function buildPrompt(args: BuildPromptArgs): {
  params: Anthropic.Messages.MessageCreateParamsNonStreaming;
  bodyTruncated: boolean;
  estimatedInputTokens: number;
} {
  const { ctx, sourceBody } = args;
  const systemText = loadSystemPrompt();

  const truncated = sourceBody.length > SOURCE_BODY_MAX_CHARS;
  const body = truncated
    ? sourceBody.slice(0, SOURCE_BODY_MAX_CHARS) + "\n\n<!-- TRUNCATED -->"
    : sourceBody;

  const contextBlock = [
    `# Source line context`,
    ``,
    `category: ${ctx.category}`,
    `vendor: ${ctx.vendor}`,
    `product_line: ${ctx.productLine}`,
    `source_path: ${ctx.sidecarRel}`,
  ].join("\n");

  const finalInstruction = [
    `# Task`,
    ``,
    `Read the sidecar below and enumerate every individual product (SKU) it covers.`,
    `Follow the conventions in the system prompt. Output ONLY the JSON object.`,
  ].join("\n");

  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: env.ANTHROPIC_EXTRACT_MODEL,
    max_tokens: 4_096,
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: cacheControl("1h"),
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: contextBlock },
          { type: "text", text: `# Sidecar body\n\n${body}` },
          { type: "text", text: finalInstruction },
        ],
      },
    ],
  };

  return {
    params,
    bodyTruncated: truncated,
    estimatedInputTokens:
      estimateTokensFromText(systemText) +
      estimateTokensFromText(contextBlock) +
      estimateTokensFromText(body) +
      estimateTokensFromText(finalInstruction),
  };
}

// ----------------------------------------------------------------------------
// Output shape
// ----------------------------------------------------------------------------

export interface ProposedProduct {
  slug: string;
  model_number: string;
  marketing_name: string;
  evidence_anchor?: string;
  evidence_quote?: string;
  confidence: number;
}

export interface LowConfidenceProduct extends ProposedProduct {
  reason?: string;
}

export interface PreviewResult {
  ctx: SourceLineContext;
  products: ProposedProduct[];
  low_confidence: LowConfidenceProduct[];
  notes: string;
  /** Filtered products that already exist on disk (won't create duplicate MDs). */
  alreadyExists: string[];
  /** Slugs the user can approve — products list filtered against alreadyExists. */
  approvable: ProposedProduct[];
  bodyTruncated: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ----------------------------------------------------------------------------
// Preview — LLM scan
// ----------------------------------------------------------------------------

import { calcCost } from "@/lib/integrations/anthropic";

export async function previewProductsFromSource(
  sourcePathRel: string,
  override?: { category?: string; vendor?: string; productLine?: string }
): Promise<PreviewResult> {
  let ctx = resolveSourceLineContext(sourcePathRel);
  if (!ctx && override?.category && override?.vendor && override?.productLine) {
    const sidecarAbs = path.resolve(DATA_DIR, sourcePathRel);
    if (!fs.existsSync(sidecarAbs)) {
      throw new Error(`Sidecar not found: ${sidecarAbs}`);
    }
    ctx = {
      category: override.category,
      vendor: override.vendor,
      productLine: override.productLine,
      sidecarAbs,
      sidecarRel: sourcePathRel,
    };
  }
  if (!ctx) {
    throw new Error(
      `Cannot resolve product line for ${sourcePathRel}. Pass override { category, vendor, productLine } if it's a category-scope source.`
    );
  }

  const sourceBody = fs.readFileSync(ctx.sidecarAbs, "utf8");
  const built = buildPrompt({ ctx, sourceBody });

  const message = await messagesCreate(built.params);
  const text = message.content
    .filter(b => b.type === "text")
    .map(b => (b as { text: string }).text)
    .join("");

  let parsed: any;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    const fence = text.match(/\{[\s\S]*\}/);
    if (!fence) {
      throw new Error(
        `Model did not return parseable JSON. First 200 chars: ${text.slice(0, 200)}`
      );
    }
    parsed = JSON.parse(fence[0]);
  }

  const products: ProposedProduct[] = (parsed.products ?? []).map(normalizeProduct);
  const lowConfidence: LowConfidenceProduct[] = (parsed.low_confidence ?? []).map(
    (p: any) => ({ ...normalizeProduct(p), reason: p.reason ?? null })
  );

  // Filter out products that already exist on disk to avoid duplicate creation.
  const alreadyExists: string[] = [];
  const approvable: ProposedProduct[] = [];
  for (const p of products) {
    const md = path.join(
      DATA_DIR,
      ctx.category,
      ctx.vendor.toLowerCase(),
      ctx.productLine,
      p.slug,
      `${p.slug}.md`
    );
    if (fs.existsSync(md)) alreadyExists.push(p.slug);
    else approvable.push(p);
  }

  const usage = message.usage;
  const cost = calcCost({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheTtl: "1h",
    batch: false,
  });

  return {
    ctx,
    products,
    low_confidence: lowConfidence,
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
    alreadyExists,
    approvable,
    bodyTruncated: built.bodyTruncated,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costUsd: cost.totalUsd,
  };
}

function normalizeProduct(p: any): ProposedProduct {
  return {
    slug: String(p.slug ?? "").toLowerCase().trim(),
    model_number: String(p.model_number ?? "").trim(),
    marketing_name: String(p.marketing_name ?? "").trim(),
    evidence_anchor: p.evidence_anchor ?? null,
    evidence_quote: p.evidence_quote ?? null,
    confidence:
      typeof p.confidence === "number" ? p.confidence : Number(p.confidence ?? 0),
  };
}

// ----------------------------------------------------------------------------
// Commit — write MD skeletons for approved slugs
// ----------------------------------------------------------------------------

export interface CommitResult {
  ctx: SourceLineContext;
  created: { slug: string; relPath: string }[];
  skipped: { slug: string; reason: string }[];
}

export async function commitProductsFromSource(
  sourcePathRel: string,
  slugs: string[],
  proposed: ProposedProduct[],
  override?: { category?: string; vendor?: string; productLine?: string }
): Promise<CommitResult> {
  let ctx = resolveSourceLineContext(sourcePathRel);
  if (!ctx && override?.category && override?.vendor && override?.productLine) {
    const sidecarAbs = path.resolve(DATA_DIR, sourcePathRel);
    if (!fs.existsSync(sidecarAbs)) {
      throw new Error(`Sidecar not found: ${sidecarAbs}`);
    }
    ctx = {
      category: override.category,
      vendor: override.vendor,
      productLine: override.productLine,
      sidecarAbs,
      sidecarRel: sourcePathRel,
    };
  }
  if (!ctx) {
    throw new Error(
      `Cannot resolve product line for ${sourcePathRel}. Pass override { category, vendor, productLine } for category-scope sources.`
    );
  }

  const created: CommitResult["created"] = [];
  const skipped: CommitResult["skipped"] = [];

  // Index proposed products by slug so we know the marketing name to write.
  const proposedMap = new Map<string, ProposedProduct>();
  for (const p of proposed) proposedMap.set(p.slug, p);

  for (const slug of slugs) {
    const proposal = proposedMap.get(slug);
    if (!proposal) {
      skipped.push({ slug, reason: "slug not in proposed list" });
      continue;
    }
    try {
      const result = writeProductMdSkeleton({
        category: ctx.category,
        vendor: ctx.vendor.toLowerCase(),
        line: ctx.productLine,
        slug: proposal.slug,
        model: proposal.marketing_name || proposal.model_number || proposal.slug,
      });
      if (result.created) {
        created.push({ slug: proposal.slug, relPath: result.relPath });
      } else {
        skipped.push({ slug: proposal.slug, reason: "product MD already exists" });
      }
    } catch (err: any) {
      skipped.push({ slug: proposal.slug, reason: err?.message ?? String(err) });
    }
  }

  return { ctx, created, skipped };
}
