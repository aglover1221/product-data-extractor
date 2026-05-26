/**
 * Core extraction pipeline.
 *
 * Builds a cache-friendly Anthropic prompt:
 *   - System: extract.md skill body, cached (1h).
 *   - User block 1: schema bundle (_base + category + all category overlays), cached (1h).
 *   - User block 2: per-product context (frontmatter + manifest summary).
 *   - User block 3: source MD bodies, in deterministic order.
 *   - Final: instruction to emit extraction.json.
 *
 * Cache prefix is identical across every product in a category, so the second
 * through Nth requests in a category fan-out hit the cache for the system
 * prompt + schema bundle.
 *
 * Two execution modes:
 *   - submitOneSync(): single Messages call (fast feedback for the smoke test).
 *   - submitBatchForCategory(): Anthropic Batch fan-out (production path; 50% off).
 */
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import {
  cacheControl,
  estimateTokensFromText,
  messagesCreate,
  submitBatch,
  type BatchRequest,
  type CacheTtl,
} from "@/lib/integrations/anthropic";
import { readProductMdManifest, type ManifestSource } from "@/lib/sources";
import { parseMarkdown } from "@/lib/safe-matter";
import { invalidateExtractionCache } from "@/lib/extractions";

const DATA_DIR = env.PRODUCT_MCP_DATA_DIR;
const SCHEMAS_DIR = path.join(DATA_DIR, "schemas");
const PROMPTS_DIR = path.resolve(process.cwd(), "lib/prompts");

// ----------------------------------------------------------------------------
// Category-to-schema mapping
//
// We load the BASE + ALL applicable overlays per category, even if some
// overlays don't apply to the current product. Two reasons:
//   1. The LLM still needs to see the overlay to decide whether it applies.
//   2. Loading the same set every time keeps the cache prefix stable for
//      every product in the category, maximizing cache hit rate.
// ----------------------------------------------------------------------------

interface CategorySchemaConfig {
  base: string[]; // relative to schemas/
  overlays: string[]; // relative to schemas/overlays/
}

const CATEGORY_CONFIG: Record<string, CategorySchemaConfig> = {
  server: {
    base: ["_base.md", "server.md"],
    overlays: [
      "gpu-server.md",
      "edge.md",
      "scale-up.md",
      "multi-node.md",
      "modular-sled.md",
    ],
  },
  "storage:san-block-array": {
    base: ["_base.md", "san-block-array.md"],
    overlays: [
      "san-entry-das.md",
      "san-hybrid-tiered.md",
      "san-clustered-federated.md",
      "san-shared-fabric-scale-out.md",
    ],
  },
  "storage:backup-target": {
    base: ["_base.md", "backup-target.md"],
    overlays: ["backup-target-virtual-edition.md"],
  },
  "storage:data-protection-software": {
    base: ["_base.md", "data-protection-software.md"],
    overlays: ["dps-integrated-appliance.md"],
  },
  "storage:scale-out-nas": {
    base: ["_base.md", "scale-out-nas.md"],
    overlays: ["multi-tier-namespace.md", "modular-chassis-cluster.md"],
  },
  "storage:scale-out-object": {
    base: ["_base.md", "scale-out-object.md"],
    overlays: ["kubernetes-native-object.md"],
  },
  hci: {
    base: ["_base.md", "hci.md"],
    overlays: [],
  },
  "software-defined-infrastructure": {
    base: ["_base.md", "software-defined-infrastructure.md"],
    overlays: [],
  },
  networking: {
    base: ["_base.md", "networking.md"],
    overlays: [
      "switch.md",
      "ethernet-switch.md",
      "fc-switch.md",
      "ib-switch.md",
      "chassis-fabric.md",
    ],
  },
  chassis: {
    base: ["_base.md", "chassis.md"],
    overlays: ["chassis-fabric.md"],
  },
};

function resolveCategoryKey(frontmatter: Record<string, any>): string {
  const category = frontmatter.category;
  if (!category) {
    throw new Error("Product MD frontmatter missing `category`");
  }
  if (category === "storage") {
    const sub = frontmatter.subcategory ?? frontmatter.platform_type;
    if (sub === "san-block-array") return "storage:san-block-array";
    if (sub === "backup" || sub === "backup-target") return "storage:backup-target";
    if (sub === "data-protection-software") return "storage:data-protection-software";
    if (sub === "scale-out-nas" || sub === "file") return "storage:scale-out-nas";
    if (sub === "scale-out-object" || sub === "object") return "storage:scale-out-object";
    throw new Error(
      `Unsupported storage subcategory \`${sub}\`. Supported: san-block-array, backup-target, data-protection-software, scale-out-nas, scale-out-object.`
    );
  }
  if (CATEGORY_CONFIG[category]) return category;
  throw new Error(`Unsupported category \`${category}\` for extraction`);
}

// ----------------------------------------------------------------------------
// Schema bundle loading (cached prefix)
// ----------------------------------------------------------------------------

interface SchemaBundle {
  text: string;
  files: string[];
  tokens: number;
}

function readSchemaFile(filename: string, isOverlay: boolean): string {
  const dir = isOverlay ? path.join(SCHEMAS_DIR, "overlays") : SCHEMAS_DIR;
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) {
    throw new Error(`Schema file not found: ${fp}`);
  }
  return fs.readFileSync(fp, "utf8");
}

export function loadSchemaBundle(categoryKey: string): SchemaBundle {
  const config = CATEGORY_CONFIG[categoryKey];
  if (!config) throw new Error(`No schema config for ${categoryKey}`);

  const parts: string[] = [];
  const files: string[] = [];

  for (const baseFile of config.base) {
    parts.push(`<!-- schemas/${baseFile} -->`);
    parts.push(readSchemaFile(baseFile, false));
    files.push(`schemas/${baseFile}`);
  }
  for (const ovFile of config.overlays) {
    parts.push(`<!-- schemas/overlays/${ovFile} -->`);
    parts.push(readSchemaFile(ovFile, true));
    files.push(`schemas/overlays/${ovFile}`);
  }

  const text = parts.join("\n\n");
  return { text, files, tokens: estimateTokensFromText(text) };
}

// ----------------------------------------------------------------------------
// System prompt (cached prefix)
// ----------------------------------------------------------------------------

let _systemPromptCache: string | null = null;
export function loadSystemPrompt(): string {
  if (_systemPromptCache) return _systemPromptCache;
  const fp = path.join(PROMPTS_DIR, "extract.md");
  _systemPromptCache = fs.readFileSync(fp, "utf8");
  return _systemPromptCache;
}

// ----------------------------------------------------------------------------
// Product context loading
// ----------------------------------------------------------------------------

export interface ProductContext {
  slug: string;
  productDir: string;
  productMdPath: string;
  frontmatter: Record<string, any>;
  manifest: ManifestSource[];
  categoryKey: string;
}

/**
 * Resolves a product reference (e.g. "server/dell/poweredge/r770") to its
 * directory + MD + manifest. The product slug for the MD filename is the last
 * path segment.
 */
export function loadProductContext(productPathRel: string): ProductContext {
  const productDir = path.resolve(DATA_DIR, productPathRel);
  if (!fs.existsSync(productDir)) {
    throw new Error(`Product directory not found: ${productDir}`);
  }
  const slug = path.basename(productDir);
  const productMdPath = path.join(productDir, `${slug}.md`);
  if (!fs.existsSync(productMdPath)) {
    throw new Error(`Product MD not found: ${productMdPath}`);
  }
  const raw = fs.readFileSync(productMdPath, "utf8");
  const parsed = parseMarkdown(raw);
  const frontmatter = parsed?.data ?? {};
  const manifest = readProductMdManifest(productDir, slug) ?? [];
  if (manifest.length === 0) {
    throw new Error(`Product MD manifest is empty: ${productMdPath}`);
  }
  const categoryKey = resolveCategoryKey(frontmatter);
  return { slug, productDir, productMdPath, frontmatter, manifest, categoryKey };
}

// ----------------------------------------------------------------------------
// Source MD body loading (uncached portion)
// ----------------------------------------------------------------------------

export interface LoadedSource {
  manifestPath: string; // exact path-as-cited (e.g. "source/technical-guide.md", "../source/spec-sheet.md")
  body: string;
  tokens: number;
}

export function loadSourceTexts(ctx: ProductContext): LoadedSource[] {
  const out: LoadedSource[] = [];
  for (const src of ctx.manifest) {
    const localExtraction = src.local_extraction;
    if (!localExtraction) continue; // sources without .md sidecars are skipped (e.g. PDFs only)
    const abs = path.resolve(ctx.productDir, localExtraction);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `Source .md sidecar not found on disk: ${abs} (manifest path: ${localExtraction}). ` +
          `Re-run pull-sources.`
      );
    }
    const body = fs.readFileSync(abs, "utf8");
    out.push({
      manifestPath: localExtraction,
      body,
      tokens: estimateTokensFromText(body),
    });
  }
  if (out.length === 0) {
    throw new Error(
      `Product manifest has no .md sidecars (local_extraction set) — every source must have a parsed sidecar.`
    );
  }
  return out;
}

// ----------------------------------------------------------------------------
// Prompt builder
// ----------------------------------------------------------------------------

export interface BuiltPrompt {
  params: Anthropic.Messages.MessageCreateParamsNonStreaming;
  estimate: {
    systemTokens: number;
    schemaTokens: number;
    productContextTokens: number;
    sourceTokens: number;
    totalInputTokens: number;
  };
}

const FINAL_INSTRUCTION = [
  "Walk every required field across the base schema AND every applicable overlay.",
  "For each field, attach an evidence object pointing at the most specific anchor.",
  "Use `evidence: source-silent` when a field is not addressed by any source.",
  "Cite manifest paths verbatim in `evidence.source` (e.g. \"source/technical-guide.md\", \"../source/spec-sheet.md\").",
  "Self-check before emitting: required fields covered, enums valid, composition rules satisfied, cross-field consistency holds.",
  "Output ONLY the JSON object — no surrounding prose, no markdown code fences. The first character of your response must be `{`.",
].join("\n");

export function buildExtractionPrompt(
  ctx: ProductContext,
  options: { cacheTtl?: CacheTtl; maxTokens?: number } = {}
): BuiltPrompt {
  const cacheTtl = options.cacheTtl ?? "1h";
  const maxTokens = options.maxTokens ?? 16000;

  const systemText = loadSystemPrompt();
  const bundle = loadSchemaBundle(ctx.categoryKey);
  const sources = loadSourceTexts(ctx);

  const productContext = [
    `# Product: ${ctx.slug}`,
    ``,
    `Frontmatter:`,
    "```yaml",
    Object.entries(ctx.frontmatter)
      .filter(([k]) => k !== "sources")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("\n"),
    "```",
    ``,
    `Manifest source paths (cite exactly in evidence.source):`,
    ...sources.map(s => `- ${s.manifestPath}`),
  ].join("\n");

  const sourcesBlob = sources
    .map(
      s =>
        `<!-- BEGIN ${s.manifestPath} -->\n${s.body}\n<!-- END ${s.manifestPath} -->`
    )
    .join("\n\n");

  const systemTokens = estimateTokensFromText(systemText);
  const schemaTokens = bundle.tokens;
  const productContextTokens = estimateTokensFromText(productContext);
  const sourceTokens = sources.reduce((acc, s) => acc + s.tokens, 0);
  const finalTokens = estimateTokensFromText(FINAL_INSTRUCTION);

  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: env.ANTHROPIC_EXTRACT_MODEL,
    max_tokens: maxTokens,
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: cacheControl(cacheTtl),
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `# Composed schema bundle\n\n${bundle.text}`,
            cache_control: cacheControl(cacheTtl),
          },
          { type: "text", text: productContext },
          { type: "text", text: `# Source sidecars\n\n${sourcesBlob}` },
          { type: "text", text: FINAL_INSTRUCTION },
        ],
      },
    ],
  };

  return {
    params,
    estimate: {
      systemTokens,
      schemaTokens,
      productContextTokens,
      sourceTokens,
      totalInputTokens:
        systemTokens + schemaTokens + productContextTokens + sourceTokens + finalTokens,
    },
  };
}

// ----------------------------------------------------------------------------
// Execution
// ----------------------------------------------------------------------------

/**
 * Sync execution via Messages API. Used by the CLI smoke test for fast
 * feedback. Production path is submitBatchForCategory().
 */
export async function submitOneSync(
  ctx: ProductContext,
  options: { cacheTtl?: CacheTtl; maxTokens?: number } = {}
): Promise<{
  message: Anthropic.Messages.Message;
  estimate: BuiltPrompt["estimate"];
}> {
  const built = buildExtractionPrompt(ctx, options);
  const message = await messagesCreate(built.params);
  return { message, estimate: built.estimate };
}

/**
 * Build N requests (one per product) and submit as a single Batch. Returns
 * the batch id; worker polls until ended and writes outputs.
 */
export async function submitBatchForCategory(
  contexts: ProductContext[],
  options: { cacheTtl?: CacheTtl; maxTokens?: number } = {}
): Promise<{ batchId: string; requestCount: number; perProductEstimate: number[] }> {
  const requests: BatchRequest[] = [];
  const perProductEstimate: number[] = [];
  for (const ctx of contexts) {
    const built = buildExtractionPrompt(ctx, options);
    requests.push({ custom_id: ctx.slug, params: built.params });
    perProductEstimate.push(built.estimate.totalInputTokens);
  }
  const result = await submitBatch(requests);
  return { ...result, perProductEstimate };
}

// ----------------------------------------------------------------------------
// Result parsing
// ----------------------------------------------------------------------------

/**
 * Extracts the JSON object from a model response. Accepts:
 *   - bare JSON (preferred, per FINAL_INSTRUCTION)
 *   - JSON wrapped in ```json fences (fallback)
 */
export function parseExtractionJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]);
  }
  throw new Error("Response did not contain a parseable JSON object");
}

export function writeExtractionJson(
  productDir: string,
  parsed: unknown
): string {
  const out = path.join(productDir, "extraction.json");
  fs.writeFileSync(out, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  invalidateExtractionCache();
  return out;
}
