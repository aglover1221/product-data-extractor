/**
 * Schema generation phase — bootstrap a category schema from reference MDs.
 *
 * Wave 7. New capability not present in current skills; produces a draft
 * schema MD that routes through Wave 3's editor for human refinement.
 *   - Input: category name, list of reference MD paths (relative to PRODUCT_MCP_DATA_DIR)
 *   - Output: draft schema MD content + a row in the `schemas` table (status='draft')
 *
 * The LLM scans the references, identifies common deterministic fields, and
 * proposes a draft schema MD that follows `schemas/_base.md` conventions. Cache
 * control is set on the system prompt + the optional skeleton so multiple gen
 * runs against the same category can amortize the prompt prefix.
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
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";
import { isPathInsideRoot } from "@/lib/path-security";

const DATA_DIR = env.PRODUCT_MCP_DATA_DIR;
const SCHEMAS_DIR = path.join(DATA_DIR, "schemas");
const PROMPTS_DIR = path.resolve(process.cwd(), "lib/prompts");

// ----------------------------------------------------------------------------
// Reference MD loading
// ----------------------------------------------------------------------------

export interface LoadedReference {
  path: string; // as supplied (relative to DATA_DIR or absolute)
  relPath: string; // canonical relative-to-data-dir form
  content: string;
  tokens: number;
}

function resolveReferencePath(p: string): { abs: string; rel: string } {
  // Accept absolute paths inside DATA_DIR or already-relative paths.
  let abs = path.isAbsolute(p) ? p : path.resolve(DATA_DIR, p);
  abs = path.resolve(abs);
  if (!isPathInsideRoot(DATA_DIR, abs)) {
    throw new Error(`Reference path escapes PRODUCT_MCP_DATA_DIR: ${p}`);
  }
  const rel = path.relative(DATA_DIR, abs);
  return { abs, rel };
}

export function loadReferenceMds(paths: string[]): LoadedReference[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("At least one reference MD path is required");
  }
  const out: LoadedReference[] = [];
  for (const p of paths) {
    const { abs, rel } = resolveReferencePath(p);
    if (!fs.existsSync(abs)) {
      throw new Error(`Reference MD not found: ${rel}`);
    }
    if (!abs.endsWith(".md")) {
      throw new Error(`Reference path must be a .md file: ${rel}`);
    }
    const content = fs.readFileSync(abs, "utf8");
    out.push({
      path: p,
      relPath: rel,
      content,
      tokens: estimateTokensFromText(content),
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Existing-schema guard
//
// Schema-gen is for NEW categories. We refuse to run if a curated schema by
// this name already exists on disk; auto-generating against an existing
// category would risk overwriting hand-tuned content. The user can still
// generate against a sandbox category name (e.g. "fault-tolerant-system")
// which is dormant per project conventions.
// ----------------------------------------------------------------------------

export function existingSchemaPath(category: string): string {
  return path.join(SCHEMAS_DIR, `${category}.md`);
}

export function existingCategorySchemaOnDisk(category: string): boolean {
  return fs.existsSync(existingSchemaPath(category));
}

// ----------------------------------------------------------------------------
// Prompt building
// ----------------------------------------------------------------------------

let _systemPromptCache: string | null = null;
function loadSystemPrompt(): string {
  if (_systemPromptCache) return _systemPromptCache;
  const fp = path.join(PROMPTS_DIR, "schema-gen.md");
  _systemPromptCache = fs.readFileSync(fp, "utf8");
  return _systemPromptCache;
}

let _baseSchemaCache: string | null = null;
function loadBaseSchema(): string {
  if (_baseSchemaCache) return _baseSchemaCache;
  const fp = path.join(SCHEMAS_DIR, "_base.md");
  if (!fs.existsSync(fp)) {
    throw new Error(`schemas/_base.md not found at ${fp} — cannot bootstrap schema generation`);
  }
  _baseSchemaCache = fs.readFileSync(fp, "utf8");
  return _baseSchemaCache;
}

// One canonical worked-example schema is bundled into the user message so the
// model has a known-good sample of the conventional shape. server.md is the
// most polished example and exercises overlay routing — apt for a draft.
let _exampleSchemaCache: string | null = null;
function loadExampleSchema(): string {
  if (_exampleSchemaCache) return _exampleSchemaCache;
  const fp = path.join(SCHEMAS_DIR, "server.md");
  if (!fs.existsSync(fp)) return ""; // graceful — example is optional
  _exampleSchemaCache = fs.readFileSync(fp, "utf8");
  return _exampleSchemaCache;
}

export interface BuiltSchemaGenPrompt {
  params: Anthropic.Messages.MessageCreateParamsNonStreaming;
  estimate: {
    systemTokens: number;
    baseTokens: number;
    exampleTokens: number;
    skeletonTokens: number;
    referenceTokens: number;
    totalInputTokens: number;
  };
}

export function buildSchemaGenPrompt(args: {
  category: string;
  references: LoadedReference[];
  skeleton?: string;
  maxTokens?: number;
}): BuiltSchemaGenPrompt {
  const { category, references, skeleton } = args;
  const maxTokens = args.maxTokens ?? 16000;

  const systemText = loadSystemPrompt();
  const baseSchema = loadBaseSchema();
  const example = loadExampleSchema();

  const today = new Date().toISOString().slice(0, 10);

  // The cached prefix: system prompt + _base.md + the example schema. These
  // never vary across runs in the same category, so cache_control sits on the
  // last block of this prefix.
  const baseBlockText = `# Convention reference: schemas/_base.md\n\n${baseSchema}`;
  const exampleBlockText = example
    ? `# Worked example: schemas/server.md (mirror this shape and cadence)\n\n${example}`
    : "";

  // Optional skeleton — also cached if present, so multiple gen iterations
  // with the same skeleton amortize.
  const skeletonBlockText = skeleton
    ? `# Skeleton schema (user-provided starting point)\n\n${skeleton}`
    : "";

  // The references vary per call; not cached.
  const referencesBlockText = [
    `# References (${references.length} source MDs)`,
    "",
    `These are Reducto-parsed sidecars from products in the future-target ` +
      `\`${category}\` category. Walk every one. Promote a field into the ` +
      `schema when ≥2 references speak to it.`,
    "",
    ...references.map(
      (r) =>
        `<!-- BEGIN ${r.relPath} -->\n${r.content}\n<!-- END ${r.relPath} -->`
    ),
  ].join("\n");

  const finalInstruction = [
    `# Task`,
    "",
    `Generate the draft for \`schemas/${category}.md\`.`,
    "",
    `- Frontmatter \`name: ${category}-schema\`, \`category: ${category}\`, \`last_updated: ${today}\`.`,
    `- H1 title cadence matching \`schemas/server.md\`.`,
    `- Tables with columns: Field | Type | Required | Enum / format | Notes.`,
    `- Cite reference paths (e.g. ${references[0]?.relPath ?? "source/<file>.md"}) ` +
      `in Notes when calling out where a field was observed.`,
    `- Output ONLY the schema markdown. First character must be \`---\`. No commentary.`,
  ].join("\n");

  // Token estimates
  const systemTokens = estimateTokensFromText(systemText);
  const baseTokens = estimateTokensFromText(baseBlockText);
  const exampleTokens = exampleBlockText ? estimateTokensFromText(exampleBlockText) : 0;
  const skeletonTokens = skeletonBlockText ? estimateTokensFromText(skeletonBlockText) : 0;
  const referenceTokens = estimateTokensFromText(referencesBlockText);
  const finalTokens = estimateTokensFromText(finalInstruction);

  // Build user content array. Place cached blocks first, then uncached. Mark
  // cache_control on the LAST cacheable block so the whole prefix is one
  // cache entry.
  type UserBlock = {
    type: "text";
    text: string;
    cache_control?: ReturnType<typeof cacheControl>;
  };
  const userContent: UserBlock[] = [];
  userContent.push({ type: "text", text: baseBlockText });
  if (exampleBlockText) userContent.push({ type: "text", text: exampleBlockText });
  if (skeletonBlockText) userContent.push({ type: "text", text: skeletonBlockText });

  // Mark cache_control on the LAST cached block.
  const lastCachedIdx = userContent.length - 1;
  if (lastCachedIdx >= 0) {
    userContent[lastCachedIdx] = {
      ...userContent[lastCachedIdx],
      cache_control: cacheControl("1h"),
    };
  }

  userContent.push({ type: "text", text: referencesBlockText });
  userContent.push({ type: "text", text: finalInstruction });

  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: env.ANTHROPIC_EXTRACT_MODEL,
    max_tokens: maxTokens,
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: cacheControl("1h"),
      },
    ],
    messages: [{ role: "user", content: userContent }],
  };

  return {
    params,
    estimate: {
      systemTokens,
      baseTokens,
      exampleTokens,
      skeletonTokens,
      referenceTokens,
      totalInputTokens:
        systemTokens +
        baseTokens +
        exampleTokens +
        skeletonTokens +
        referenceTokens +
        finalTokens,
    },
  };
}

// ----------------------------------------------------------------------------
// Output cleanup + version assignment
// ----------------------------------------------------------------------------

/**
 * Strips any leading/trailing prose the model accidentally emitted around the
 * schema markdown. Schema MDs always begin with `---` (frontmatter fence).
 */
export function extractSchemaMd(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("---")) return trimmed;
  // Drop any leading commentary; locate the first frontmatter fence.
  const idx = trimmed.indexOf("\n---");
  if (idx === -1) {
    throw new Error("Model output did not contain a schema frontmatter fence (`---`)");
  }
  return trimmed.slice(idx + 1).trim();
}

function assignDraftVersion(category: string): string {
  ensureStudioSchema();
  const db = getStudioDb();
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM schemas WHERE name = ?")
    .get(category) as { c: number } | undefined;
  const seq = (row?.c ?? 0) + 1;
  return `v0.${seq}-draft`;
}

// ----------------------------------------------------------------------------
// Orchestrator
// ----------------------------------------------------------------------------

export interface GenerateSchemaResult {
  schemaId: number;
  name: string;
  version: string;
  contentMd: string;
  estimate: BuiltSchemaGenPrompt["estimate"];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

export async function generateSchema(args: {
  category: string;
  referenceMdPaths: string[];
  skeletonMd?: string;
}): Promise<GenerateSchemaResult> {
  const category = args.category.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(category)) {
    throw new Error(
      `Invalid category name \`${args.category}\`: must be lowercase, alphanumeric, hyphens only`
    );
  }
  if (existingCategorySchemaOnDisk(category)) {
    throw new Error(
      `Refusing to generate schema for \`${category}\`: schemas/${category}.md already exists. ` +
        `Schema-gen is for NEW categories only. Pick a different name or edit the existing schema via the editor.`
    );
  }

  const references = loadReferenceMds(args.referenceMdPaths);
  const built = buildSchemaGenPrompt({
    category,
    references,
    skeleton: args.skeletonMd,
  });

  const message = await messagesCreate(built.params);

  // Concatenate text content blocks of the response.
  const textBlocks = (message.content as Array<{ type: string; text?: string }>).filter(
    (b) => b.type === "text" && typeof b.text === "string"
  ) as Array<{ type: "text"; text: string }>;
  const text = textBlocks.map((b) => b.text).join("\n");
  if (!text.trim()) {
    throw new Error("Model returned an empty response");
  }
  const contentMd = extractSchemaMd(text);

  const version = assignDraftVersion(category);

  ensureStudioSchema();
  const db = getStudioDb();
  const insert = db
    .prepare(
      `INSERT INTO schemas (name, version, content_md, generated_from_json, status, created_at)
       VALUES (?, ?, ?, ?, 'draft', ?)`
    )
    .run(
      category,
      version,
      contentMd,
      JSON.stringify({
        reference_md_paths: references.map((r) => r.relPath),
        had_skeleton: Boolean(args.skeletonMd),
        model: built.params.model,
      }),
      new Date().toISOString()
    );

  const usage = (message as any).usage ?? {};
  return {
    schemaId: Number(insert.lastInsertRowid),
    name: category,
    version,
    contentMd,
    estimate: built.estimate,
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    },
  };
}
