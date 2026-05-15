/**
 * Spot-fix phase — address one human-flagged annotation.
 *
 * Wave 5. Mirrors the `spot-fix-extraction` skill.
 *   - Input: productSlug + annotationId (one open flag at a time).
 *   - Process: load extraction.json + annotations.json + relevant source MD section,
 *     build a Messages API prompt, parse `{resolution, new_value?, evidence?, rationale}`.
 *   - Output: insert `spotfix_runs` row (status=pending-review). Caller then either
 *     accepts (writes extraction.json + closes annotation) or rejects (closes the run).
 *
 * Uses Messages API (interactive), NOT Batch — round-trip latency target <60s.
 * Cache_control(1h) on system prompt + extraction.json so repeat spot-fixes on
 * the same product reuse the cached prefix.
 */
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";
import {
  cacheControl,
  calcCost,
  estimateTokensFromText,
  messagesCreate,
} from "@/lib/integrations/anthropic";
import { readProductMdManifest, type ManifestSource } from "@/lib/sources";
import { getProductDir, resolveProductSourcePath } from "@/lib/extractions";
import { readAnnotations, writeAnnotations, type Annotation } from "@/lib/annotations";
import {
  appendSpotFixLog,
  atomicWriteJson,
  currentEvidenceSource,
  getField,
  jsonSnippet,
  pathResolves,
  setField,
  unwrapValue,
} from "@/lib/pipeline/extraction-paths";

const PROMPTS_DIR = path.resolve(process.cwd(), "lib/prompts");

// ----------------------------------------------------------------------------
// System prompt loading
// ----------------------------------------------------------------------------

let _systemPromptCache: string | null = null;
function loadSystemPrompt(): string {
  if (_systemPromptCache) return _systemPromptCache;
  const fp = path.join(PROMPTS_DIR, "spotfix.md");
  _systemPromptCache = fs.readFileSync(fp, "utf8");
  return _systemPromptCache;
}

// ----------------------------------------------------------------------------
// Context loading
// ----------------------------------------------------------------------------

export interface SpotfixContext {
  productSlug: string;
  productDir: string;
  extractionPath: string;
  extraction: any;
  annotation: Annotation;
  manifest: ManifestSource[];
  /** Source sections (manifest-relative path → MD body) loaded for the prompt. */
  sourceSections: { manifestPath: string; body: string; truncated: boolean }[];
  /** The current value at field_path (unwrapped) and the wrapper if wrapped. */
  beforeValue: any;
  beforeRaw: any;
  /** Manifest local: path the existing evidence cites, if any. */
  citedSource: string | null;
  pathResolves: boolean;
}

const SOURCE_WINDOW_CHARS = 60_000; // ~15k tokens — keep total prompt small for latency
const ANNOTATION_NOT_FIXABLE = new Set(["resolved", "wont-fix"]);

export function loadSpotfixContext(
  productSlug: string,
  annotationId: string
): SpotfixContext {
  const productDir = getProductDir(productSlug);
  if (!productDir) {
    throw new Error(`Product directory not found for slug: ${productSlug}`);
  }
  const extractionPath = path.join(productDir, "extraction.json");
  if (!fs.existsSync(extractionPath)) {
    throw new Error(`extraction.json not found: ${extractionPath}`);
  }
  const extraction = JSON.parse(fs.readFileSync(extractionPath, "utf8"));

  const annFile = readAnnotations(productSlug);
  const annotation = annFile.annotations.find((a) => a.id === annotationId);
  if (!annotation) {
    throw new Error(`Annotation ${annotationId} not found for product ${productSlug}`);
  }
  if (annotation.type !== "flag") {
    throw new Error(
      `Annotation ${annotationId} is type=${annotation.type}; spot-fix only handles type=flag`
    );
  }
  if (ANNOTATION_NOT_FIXABLE.has(annotation.status)) {
    throw new Error(
      `Annotation ${annotationId} is already ${annotation.status}; reopen it before spot-fixing`
    );
  }

  const manifest = readProductMdManifest(productDir, productSlug) ?? [];

  const fieldPath = annotation.field_path;
  const beforeRaw = getField(extraction, fieldPath);
  const beforeValue = unwrapValue(beforeRaw);
  const resolves = pathResolves(extraction, fieldPath);
  const citedSource = currentEvidenceSource(extraction, fieldPath);

  // Pick which source MDs to load. Strategy:
  //   1. If the existing evidence.source resolves on disk, load that as the primary anchor.
  //   2. Otherwise, fall back to ALL manifest sidecars (small enough — extraction is per-product).
  // Truncate each body to SOURCE_WINDOW_CHARS so the prompt stays well under model limits.
  const candidates: ManifestSource[] = [];
  if (citedSource) {
    const cited = manifest.find((m) => m.local === citedSource || m.local_extraction === citedSource);
    if (cited) candidates.push(cited);
  }
  // Always include other manifest sidecars as fallback — agent decides which to read.
  for (const m of manifest) {
    if (!candidates.includes(m)) candidates.push(m);
  }

  const sourceSections: SpotfixContext["sourceSections"] = [];
  for (const src of candidates) {
    if (!src.local_extraction) continue; // PDFs without sidecars skipped
    const abs = resolveProductSourcePath(productSlug, src.local_extraction);
    if (!abs) continue;
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const truncated = body.length > SOURCE_WINDOW_CHARS;
    if (truncated) body = body.slice(0, SOURCE_WINDOW_CHARS) + "\n\n<!-- TRUNCATED -->";
    sourceSections.push({ manifestPath: src.local_extraction, body, truncated });
  }

  return {
    productSlug,
    productDir,
    extractionPath,
    extraction,
    annotation,
    manifest,
    sourceSections,
    beforeValue,
    beforeRaw,
    citedSource,
    pathResolves: resolves,
  };
}

// ----------------------------------------------------------------------------
// Prompt builder
// ----------------------------------------------------------------------------

const RESPONSE_INSTRUCTION = [
  "Output ONLY a JSON object with this shape — no surrounding prose, no markdown fences:",
  "{",
  '  "resolution": "fixed" | "wont-fix" | "open-with-analysis",',
  '  "new_value": <the new value> | null,           // present iff resolution=fixed',
  '  "evidence": {                                   // present iff resolution=fixed',
  '    "source": "<manifest local: path verbatim>",',
  '    "anchor": "<table caption or section heading>",',
  '    "page": <page number, optional>,',
  '    "quote": "<verbatim quote, ≤150 chars>",',
  '    "confidence": <number ≥ 0.7>',
  "  },",
  '  "rationale": "<≤300 chars: why this resolution>"',
  "}",
  "",
  "Resolution semantics:",
  '- "fixed": source clearly supports a different value than current AND user reasoning aligns. Confidence ≥ 0.7.',
  '- "wont-fix": source confirms the CURRENT value; user is wrong (misreading, outdated, schema rule). Confidence ≥ 0.7.',
  '- "open-with-analysis": source is silent/contradictory or confidence < 0.7. Leave annotation open with rationale.',
  "",
  "Rules:",
  "- evidence.source MUST equal a manifest path verbatim (e.g. \"source/technical-guide.md\" or \"../source/spec-sheet.md\").",
  "- evidence.quote MUST be verbatim from the source, ≤150 chars. No paraphrasing.",
  "- The first character of your response must be `{`.",
].join("\n");

export interface BuiltSpotfixPrompt {
  params: Anthropic.Messages.MessageCreateParamsNonStreaming;
  estimate: {
    systemTokens: number;
    extractionTokens: number;
    sourceTokens: number;
    annotationTokens: number;
    totalInputTokens: number;
  };
}

export function buildSpotfixPrompt(ctx: SpotfixContext): BuiltSpotfixPrompt {
  const systemText = loadSystemPrompt();

  // The full extraction.json is small enough to ship inline; gives the model
  // schema-shape context for the field at field_path + adjacent fields.
  const extractionText = JSON.stringify(ctx.extraction, null, 2);

  const annotationBlock = [
    `# Spot-fix request`,
    ``,
    `Product slug: ${ctx.productSlug}`,
    `Annotation id: ${ctx.annotation.id}`,
    `Field path: ${ctx.annotation.field_path}`,
    `Annotation created: ${ctx.annotation.created_at}`,
    `field_path resolves in extraction.json: ${ctx.pathResolves ? "yes" : "NO"}`,
    ``,
    `Current value at field_path:`,
    "```json",
    jsonSnippet(ctx.beforeRaw ?? null),
    "```",
    ``,
    `Existing evidence.source (manifest path): ${ctx.citedSource ?? "(none — field has no prior evidence record)"}`,
    ``,
    `User's flag reasoning (a HYPOTHESIS — verify against source):`,
    "```",
    ctx.annotation.text,
    "```",
  ].join("\n");

  const sourcesBlob = ctx.sourceSections
    .map(
      (s) =>
        `<!-- BEGIN ${s.manifestPath}${s.truncated ? " (truncated)" : ""} -->\n` +
        s.body +
        `\n<!-- END ${s.manifestPath} -->`
    )
    .join("\n\n");

  const manifestSummary = [
    `Manifest source paths available (cite verbatim in evidence.source):`,
    ...ctx.manifest
      .filter((m) => !!m.local_extraction)
      .map((m) => `- ${m.local_extraction}  (type: ${m.type}${m.title ? `, ${m.title}` : ""})`),
  ].join("\n");

  const systemTokens = estimateTokensFromText(systemText);
  const extractionTokens = estimateTokensFromText(extractionText);
  const sourceTokens = ctx.sourceSections.reduce(
    (acc, s) => acc + estimateTokensFromText(s.body),
    0
  );
  const annotationTokens =
    estimateTokensFromText(annotationBlock) +
    estimateTokensFromText(manifestSummary) +
    estimateTokensFromText(RESPONSE_INSTRUCTION);

  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: env.ANTHROPIC_EXTRACT_MODEL,
    max_tokens: 4000,
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
          {
            // extraction.json is the natural cache boundary — repeat spot-fixes
            // on the same product reuse this prefix.
            type: "text",
            text: `# Current extraction.json (full)\n\n\`\`\`json\n${extractionText}\n\`\`\``,
            cache_control: cacheControl("1h"),
          },
          { type: "text", text: manifestSummary },
          {
            type: "text",
            text: ctx.sourceSections.length
              ? `# Source sidecars\n\n${sourcesBlob}`
              : `# Source sidecars\n\n(no sidecars resolved on disk — work from the existing evidence in the extraction.json above and the manifest summary)`,
          },
          { type: "text", text: annotationBlock },
          { type: "text", text: RESPONSE_INSTRUCTION },
        ],
      },
    ],
  };

  return {
    params,
    estimate: {
      systemTokens,
      extractionTokens,
      sourceTokens,
      annotationTokens,
      totalInputTokens: systemTokens + extractionTokens + sourceTokens + annotationTokens,
    },
  };
}

// ----------------------------------------------------------------------------
// Result parsing
// ----------------------------------------------------------------------------

export interface SpotfixResult {
  resolution: "fixed" | "wont-fix" | "open-with-analysis";
  new_value?: any;
  evidence?: {
    source: string;
    anchor?: string;
    page?: number;
    quote?: string;
    confidence?: number;
  };
  rationale: string;
}

function parseSpotfixJson(raw: string): SpotfixResult {
  const trimmed = raw.trim();
  let jsonText = trimmed;
  if (!trimmed.startsWith("{")) {
    const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fence) jsonText = fence[1];
  }
  const parsed = JSON.parse(jsonText) as SpotfixResult;
  if (
    parsed.resolution !== "fixed" &&
    parsed.resolution !== "wont-fix" &&
    parsed.resolution !== "open-with-analysis"
  ) {
    throw new Error(`Invalid resolution: ${(parsed as any).resolution}`);
  }
  if (typeof parsed.rationale !== "string") {
    throw new Error("Missing rationale");
  }
  if (parsed.resolution === "fixed") {
    if (parsed.evidence == null) {
      throw new Error("resolution=fixed requires evidence object");
    }
    if (typeof parsed.evidence.source !== "string") {
      throw new Error("evidence.source missing");
    }
  }
  return parsed;
}

// ----------------------------------------------------------------------------
// Orchestrator: runSpotfix
// ----------------------------------------------------------------------------

export interface RunSpotfixOutput {
  runId: number;
  resolution: SpotfixResult["resolution"];
  before: any;
  after: any;
  rationale: string;
  evidence: SpotfixResult["evidence"] | null;
  status: "pending-review" | "failed";
  costUsd: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Run a single spot-fix end-to-end. Inserts a `spotfix_runs` row with
 * status=pending-review and returns the run id + before/after for the caller
 * to render. The caller (UI) then accepts or rejects.
 */
export async function runSpotfix(
  productSlug: string,
  annotationId: string
): Promise<RunSpotfixOutput> {
  ensureStudioSchema();
  const db = getStudioDb();

  const ctx = loadSpotfixContext(productSlug, annotationId);
  const built = buildSpotfixPrompt(ctx);

  const startedAt = nowIso();
  const insertStmt = db.prepare(
    `INSERT INTO spotfix_runs
       (annotation_id, product_slug, field_path, before_value, after_value, rationale,
        status, accepted_by_user, input_tokens, output_tokens, cost_usd,
        started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
  );

  let message: Anthropic.Messages.Message;
  try {
    message = await messagesCreate(built.params);
  } catch (err: any) {
    const info = insertStmt.run(
      annotationId,
      productSlug,
      ctx.annotation.field_path,
      JSON.stringify(ctx.beforeValue ?? null),
      null,
      `LLM call failed: ${err?.message ?? String(err)}`,
      "failed",
      null,
      null,
      null,
      startedAt,
      nowIso()
    );
    return {
      runId: Number(info.lastInsertRowid),
      resolution: "open-with-analysis",
      before: ctx.beforeValue,
      after: null,
      rationale: `LLM call failed: ${err?.message ?? String(err)}`,
      evidence: null,
      status: "failed",
      costUsd: 0,
    };
  }

  const usage = message.usage as any;
  const inputTokens = (usage?.input_tokens ?? 0) as number;
  const outputTokens = (usage?.output_tokens ?? 0) as number;
  const cacheReadTokens = (usage?.cache_read_input_tokens ?? 0) as number;
  const cacheCreationTokens = (usage?.cache_creation_input_tokens ?? 0) as number;

  const cost = calcCost({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTtl: "1h",
    batch: false,
  });

  // Concatenate text blocks from the response.
  const textParts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") textParts.push(block.text);
  }
  const raw = textParts.join("\n").trim();

  let result: SpotfixResult;
  try {
    result = parseSpotfixJson(raw);
  } catch (err: any) {
    const info = insertStmt.run(
      annotationId,
      productSlug,
      ctx.annotation.field_path,
      JSON.stringify(ctx.beforeValue ?? null),
      null,
      `Failed to parse model response: ${err?.message ?? String(err)}\n\nRaw:\n${raw.slice(0, 2000)}`,
      "failed",
      inputTokens,
      outputTokens,
      cost.totalUsd,
      startedAt,
      nowIso()
    );
    return {
      runId: Number(info.lastInsertRowid),
      resolution: "open-with-analysis",
      before: ctx.beforeValue,
      after: null,
      rationale: `Could not parse model response: ${err?.message ?? String(err)}`,
      evidence: null,
      status: "failed",
      costUsd: cost.totalUsd,
    };
  }

  const after = result.resolution === "fixed" ? result.new_value : null;

  const info = insertStmt.run(
    annotationId,
    productSlug,
    ctx.annotation.field_path,
    JSON.stringify(ctx.beforeValue ?? null),
    after === null ? null : JSON.stringify(after),
    result.rationale,
    "pending-review",
    inputTokens,
    outputTokens,
    cost.totalUsd,
    startedAt,
    nowIso()
  );

  return {
    runId: Number(info.lastInsertRowid),
    resolution: result.resolution,
    before: ctx.beforeValue,
    after,
    rationale: result.rationale,
    evidence: result.evidence ?? null,
    status: "pending-review",
    costUsd: cost.totalUsd,
  };
}

// ----------------------------------------------------------------------------
// Accept / reject
// ----------------------------------------------------------------------------

interface SpotfixRunRow {
  id: number;
  annotation_id: string;
  product_slug: string;
  field_path: string;
  before_value: string | null;
  after_value: string | null;
  rationale: string | null;
  status: string;
}

function loadRun(runId: number): SpotfixRunRow {
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT id, annotation_id, product_slug, field_path, before_value, after_value, rationale, status
       FROM spotfix_runs WHERE id = ?`
    )
    .get(runId) as SpotfixRunRow | undefined;
  if (!row) throw new Error(`spotfix_runs row ${runId} not found`);
  return row;
}

/**
 * Accept a pending-review spot-fix:
 *   - Apply new_value at field_path in extraction.json (atomic write).
 *   - Replace the field's evidence with the LLM-supplied evidence + spot_fix marker.
 *   - Append to extraction_metadata.spot_fix_log.
 *   - Mark annotation status='resolved' with resolution_summary.
 *   - Mark spotfix_runs status='accepted'.
 *
 * Reads the run's `after_value` and `rationale`. The original LLM evidence
 * object is reconstructed from the run's after_value + rationale; for richer
 * evidence (anchor/page/quote), pass it explicitly via `evidenceOverride`.
 */
export interface AcceptOptions {
  evidenceOverride?: {
    source: string;
    anchor?: string;
    page?: number;
    quote?: string;
    confidence?: number;
  };
}

export function acceptSpotfix(
  runId: number,
  options: AcceptOptions = {}
): { extractionPath: string; fieldPath: string; before: any; after: any } {
  ensureStudioSchema();
  const db = getStudioDb();
  const run = loadRun(runId);
  if (run.status !== "pending-review") {
    throw new Error(`spotfix_runs ${runId} status=${run.status}; can only accept pending-review`);
  }

  const productDir = getProductDir(run.product_slug);
  if (!productDir) throw new Error(`product dir not found: ${run.product_slug}`);
  const extractionPath = path.join(productDir, "extraction.json");
  const extraction = JSON.parse(fs.readFileSync(extractionPath, "utf8"));

  const newValue = run.after_value === null ? null : JSON.parse(run.after_value);
  const oldValue = run.before_value === null ? null : JSON.parse(run.before_value);

  // Build the evidence object. Without override, we leave the existing evidence
  // structure but mark it as spot-fixed.
  const fixedAt = nowIso();
  const evidence = options.evidenceOverride ?? undefined;
  const spotFix = {
    annotation_id: run.annotation_id,
    old_value: oldValue,
    fixed_at: fixedAt,
  };

  const setResult = setField(extraction, run.field_path, newValue, {
    evidence,
    spotFix,
  });
  if (!setResult.ok) {
    throw new Error(`Failed to set field ${run.field_path}: ${setResult.reason}`);
  }

  // Append to spot_fix_log
  const ann = readAnnotations(run.product_slug);
  const annotation = ann.annotations.find((a) => a.id === run.annotation_id);
  appendSpotFixLog(extraction, {
    annotation_id: run.annotation_id,
    field_path: run.field_path,
    old_value: oldValue,
    new_value: newValue,
    source_quote: evidence?.quote ?? null,
    user_reasoning: annotation?.text?.slice(0, 200) ?? null,
    rationale: run.rationale,
    fixed_at: fixedAt,
  });

  atomicWriteJson(extractionPath, extraction);

  // Mark the annotation resolved.
  if (annotation) {
    annotation.status = "resolved";
    annotation.resolution_summary =
      `[spot-fix #${runId}] ${run.rationale ?? ""}`.slice(0, 1000);
    annotation.resolved_at = fixedAt;
    writeAnnotations(run.product_slug, ann);
  }

  db.prepare(
    `UPDATE spotfix_runs
       SET status='accepted', accepted_by_user=1, completed_at=?
     WHERE id=?`
  ).run(fixedAt, runId);

  return {
    extractionPath,
    fieldPath: run.field_path,
    before: oldValue,
    after: newValue,
  };
}

/**
 * Reject a pending-review spot-fix. Marks run status=rejected. Stores the
 * agent's rationale on the annotation row (resolution_summary) so the human
 * has context for re-review. Annotation stays `open`.
 */
export function rejectSpotfix(
  runId: number,
  reason?: string
): { annotationId: string; rationale: string | null } {
  ensureStudioSchema();
  const db = getStudioDb();
  const run = loadRun(runId);
  if (run.status !== "pending-review") {
    throw new Error(`spotfix_runs ${runId} status=${run.status}; can only reject pending-review`);
  }

  const completedAt = nowIso();
  db.prepare(
    `UPDATE spotfix_runs
       SET status='rejected', accepted_by_user=0, completed_at=?
     WHERE id=?`
  ).run(completedAt, runId);

  // Store agent rationale on the annotation row for re-review. Annotation
  // remains 'open' — the human still needs to act.
  const ann = readAnnotations(run.product_slug);
  const annotation = ann.annotations.find((a) => a.id === run.annotation_id);
  if (annotation) {
    const summary = [
      `[spot-fix #${runId} rejected]`,
      run.rationale ? `Agent: ${run.rationale}` : null,
      reason ? `Rejection: ${reason}` : null,
    ]
      .filter(Boolean)
      .join(" — ");
    annotation.resolution_summary = summary.slice(0, 1000);
    writeAnnotations(run.product_slug, ann);
  }

  return {
    annotationId: run.annotation_id,
    rationale: run.rationale,
  };
}

/** Convenience: load a spotfix_runs row by id, parsed. */
export function getSpotfixRun(runId: number): {
  id: number;
  annotationId: string;
  productSlug: string;
  fieldPath: string;
  before: any;
  after: any;
  rationale: string | null;
  status: string;
} {
  const row = loadRun(runId);
  return {
    id: row.id,
    annotationId: row.annotation_id,
    productSlug: row.product_slug,
    fieldPath: row.field_path,
    before: row.before_value === null ? null : JSON.parse(row.before_value),
    after: row.after_value === null ? null : JSON.parse(row.after_value),
    rationale: row.rationale,
    status: row.status,
  };
}
