/**
 * Parse phase — submit PDFs to Reducto, save .md sidecars.
 *
 * Wave 4. Mirrors the `pull-sources` skill parsing leg.
 *   - Input: source row id (or sourcePath)
 *   - Output: .md sidecar adjacent to PDF, image crops, validation report
 *   - Persistence: parse_runs table
 *
 * Worker handler `worker/handlers/reducto.ts` polls Reducto for each parse_run
 * and calls processParseResult() when the upstream job completes.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { getStudioDb } from "@/lib/db/client";
import { enqueueJob } from "@/lib/jobs/queue";
import {
  submitParse,
  fetchJobResult,
  getJobStatus,
  downloadImage,
  assembleMarkdown,
  type ReductoParseConfig,
} from "@/lib/integrations/reducto";
import { appendSourceEntry, readSourcesYaml } from "@/lib/pipeline/sources-yaml";
import { resolveProductContext } from "@/lib/pipeline/sources";

const POLL_DELAY_SECONDS = 30;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function absSourcePath(rel: string): string {
  return path.isAbsolute(rel) ? rel : path.resolve(env.PRODUCT_MCP_DATA_DIR, rel);
}

function relSourcePath(abs: string): string {
  return path.relative(env.PRODUCT_MCP_DATA_DIR, abs);
}

/** Replace .pdf extension with .md (case-insensitive). */
export function sidecarPathForPdf(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, ".md");
}

// ----------------------------------------------------------------------------
// submitParseForSource — entrypoint for "run" / "re-run" buttons.
// ----------------------------------------------------------------------------

export interface SubmitParseInput {
  /** Either a `sources` row id OR an explicit source path (relative to PRODUCT_MCP_DATA_DIR). */
  sourceId?: number;
  sourcePath?: string;
  config?: ReductoParseConfig;
}

export interface SubmitParseOutput {
  parseRunId: number;
  sourcePath: string;
  reductoJobId: string;
}

/**
 * Look up source path, submit to Reducto, insert parse_runs row, enqueue
 * a `reducto-poll` job. Idempotent in the sense that a "re-run" simply
 * inserts a new parse_runs row — old completed runs remain visible in
 * history. Callers that want to suppress duplicate runs check the row
 * status via the parse status board first.
 */
export async function submitParseForSource(
  input: SubmitParseInput
): Promise<SubmitParseOutput> {
  const db = getStudioDb();

  let sourcePath: string;
  let sourceId: number | null = null;
  if (input.sourceId != null) {
    const row = db
      .prepare(`SELECT id, local_path FROM sources WHERE id = ?`)
      .get(input.sourceId) as { id: number; local_path: string } | undefined;
    if (!row) throw new Error(`sources row ${input.sourceId} not found`);
    sourceId = row.id;
    sourcePath = row.local_path;
  } else if (input.sourcePath) {
    sourcePath = input.sourcePath;
    // Best-effort: resolve to a sources row by local_path so we can FK-link.
    const row = db
      .prepare(`SELECT id FROM sources WHERE local_path = ? LIMIT 1`)
      .get(input.sourcePath) as { id: number } | undefined;
    sourceId = row?.id ?? null;
  } else {
    throw new Error("submitParseForSource requires sourceId or sourcePath");
  }

  const abs = absSourcePath(sourcePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`PDF not found on disk: ${abs}`);
  }
  if (!abs.toLowerCase().endsWith(".pdf")) {
    throw new Error(`Not a PDF (Reducto only): ${abs}`);
  }

  const { jobId } = await submitParse(abs, input.config ?? {});

  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO parse_runs
       (source_id, source_path, reducto_job_id, status, started_at)
     VALUES (?, ?, ?, 'running', ?)`
  );
  const info = insert.run(sourceId, sourcePath, jobId, now);
  const parseRunId = Number(info.lastInsertRowid);

  enqueueJob<{ parseRunId: number; reductoJobId: string }>(
    "reducto-poll",
    { parseRunId, reductoJobId: jobId },
    new Date(Date.now() + POLL_DELAY_SECONDS * 1000)
  );

  return { parseRunId, sourcePath, reductoJobId: jobId };
}

// ----------------------------------------------------------------------------
// processParseResult — called by the worker once Reducto is done.
// ----------------------------------------------------------------------------

export interface ProcessParseResultArgs {
  parseRunId: number;
}

export async function processParseResult({
  parseRunId,
}: ProcessParseResultArgs): Promise<{ outputMdPath: string; warnings: string[] }> {
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT id, source_path, reducto_job_id, status, output_md_path
       FROM parse_runs WHERE id = ?`
    )
    .get(parseRunId) as
    | {
        id: number;
        source_path: string;
        reducto_job_id: string | null;
        status: string;
        output_md_path: string | null;
      }
    | undefined;
  if (!row) throw new Error(`parse_runs row ${parseRunId} not found`);

  // Idempotency: already-completed runs short-circuit.
  if (row.status === "completed" && row.output_md_path) {
    return { outputMdPath: row.output_md_path, warnings: [] };
  }
  if (!row.reducto_job_id) {
    throw new Error(`parse_runs ${parseRunId} has no reducto_job_id`);
  }

  const meta = await getJobStatus(row.reducto_job_id);
  const status = meta.status?.toLowerCase();
  if (status !== "completed") {
    throw new Error(
      `processParseResult invoked but Reducto status=${meta.status} (expected Completed)`
    );
  }

  const { chunks, usage } = await fetchJobResult(meta);

  const pdfAbs = absSourcePath(row.source_path);
  const sidecarAbs = sidecarPathForPdf(pdfAbs);
  const sidecarRel = relSourcePath(sidecarAbs);
  const sourceDir = path.dirname(pdfAbs);
  const imgDirAbs = path.join(sourceDir, "images", "reducto");
  const imgSubdir = "images/reducto";

  const { md, imageRefs } = assembleMarkdown(
    chunks,
    usage,
    imgSubdir,
    path.basename(pdfAbs)
  );

  fs.mkdirSync(imgDirAbs, { recursive: true });

  // Download + filter + recompress images per the pull-sources skill rules
  // (drop crops < 5,000 px² or shortest side < 50 px; recompress to JPEG q85;
  // longest side ≤ 1,600 px). downloadImage forces .jpg on disk, matching the
  // .jpg suffix we already use in assembleMarkdown's localName.
  let imagesKept = 0;
  let imagesFiltered = 0;
  let imagesFailed = 0;
  for (const ref of imageRefs) {
    const dest = path.join(imgDirAbs, ref.localName);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100) {
      imagesKept++;
      continue;
    }
    const r = await downloadImage(ref.url, dest);
    if (r.status === "kept") imagesKept++;
    else if (r.status === "filtered") imagesFiltered++;
    else imagesFailed++;
  }

  // Atomic write of the sidecar.
  const tmp = sidecarAbs + ".part";
  fs.writeFileSync(tmp, md, "utf8");
  fs.renameSync(tmp, sidecarAbs);

  const validation = validateParsedMd(md);
  validation.imagesKept = imagesKept;
  validation.imagesFiltered = imagesFiltered;
  validation.imagesFailed = imagesFailed;

  // Content-grep: case-insensitive substring of canonical product name in the
  // sidecar. Skill step 7 — catches vendor matrix-index errors (the same
  // matrix that handed us the wrong PDF). Persisted to sources.yaml; we never
  // auto-delete on miss (skill rule: let the human decide).
  const grep = await runContentGrep(row.source_path, md);

  // Update the sources.yaml entry for this PDF with the post-parse fields:
  // markdown_sidecar / *_chars / *_source / reducto_pages / reducto_credits /
  // reducto_images_kept / reducto_images_filtered / content_grep.
  await updateSourcesYamlAfterParse({
    sourcePath: row.source_path,
    sidecarRel,
    sidecarChars: md.length,
    reductoPages: usage.num_pages ?? null,
    reductoCredits: usage.credits ?? null,
    imagesKept,
    imagesFiltered,
    contentGrep: grep,
  });

  db.prepare(
    `UPDATE parse_runs SET
       status = 'completed',
       output_md_path = ?,
       validation_json = ?,
       error = NULL,
       completed_at = ?
     WHERE id = ?`
  ).run(sidecarRel, JSON.stringify(validation), nowIso(), parseRunId);

  return { outputMdPath: sidecarRel, warnings: validation.warnings };
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

export interface ValidationReport {
  pageCount: number;
  tableCount: number;
  anchorCount: number;
  charCount: number;
  textDensity: number; // chars / pages
  warnings: string[];
  imagesKept?: number;
  imagesFiltered?: number;
  imagesFailed?: number;
}

export function validateParsedMd(mdContent: string): ValidationReport {
  const anchorMatches = mdContent.match(/<!--\s*page:\s*\d+\s*-->/g) ?? [];
  const anchorCount = anchorMatches.length;

  const pageNumbers = anchorMatches
    .map(m => Number(m.replace(/[^\d]/g, "")))
    .filter(n => Number.isFinite(n));
  const pageCount = pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0;

  const tableMatches = mdContent.match(/<table[\s>]/gi) ?? [];
  const tableCount = tableMatches.length;

  const charCount = mdContent.length;
  const textDensity = pageCount > 0 ? Math.round(charCount / pageCount) : charCount;

  const warnings: string[] = [];
  if (anchorCount === 0) {
    warnings.push("no `<!-- page: N -->` anchors found — Reducto may not have emitted page markers");
  } else if (anchorCount < pageCount) {
    warnings.push(`anchor count (${anchorCount}) less than max page (${pageCount})`);
  }
  if (pageCount > 0 && textDensity < 500) {
    warnings.push(
      `low text density: ${textDensity} chars/page (< 500 threshold) — likely scanned-only PDF or parse truncation`
    );
  }
  if (charCount < 1000) {
    warnings.push(`sidecar suspiciously short (${charCount} chars total)`);
  }

  return {
    pageCount,
    tableCount,
    anchorCount,
    charCount,
    textDensity,
    warnings,
  };
}

// ----------------------------------------------------------------------------
// Synthesizing validation from existing on-disk sidecars (seed script).
// ----------------------------------------------------------------------------

export function validateExistingSidecar(absPath: string): ValidationReport {
  const md = fs.readFileSync(absPath, "utf8");
  return validateParsedMd(md);
}

// Re-export so worker handler can use the same module surface.
export { sidecarPathForPdf as _sidecarPathForPdf };

// ----------------------------------------------------------------------------
// Content-grep + sources.yaml update — skill steps 7 + 9.
//
// Once the sidecar is on disk, run a case-insensitive substring of the
// canonical product name against the body. The result is informational —
// we never auto-delete on miss (skill rule). Persist to sources.yaml so
// downstream extraction has the audit trail.
// ----------------------------------------------------------------------------

export interface ContentGrepResult {
  query: string;
  matched: boolean | null;
}

export async function runContentGrep(
  sourcePath: string,
  mdBody: string
): Promise<ContentGrepResult> {
  const slug = lookupProductSlugForSourcePath(sourcePath);
  if (!slug) {
    return { query: "", matched: null };
  }
  const ctx = resolveProductContext(slug);
  if (!ctx?.canonical_name) {
    return { query: "", matched: null };
  }
  const query = ctx.canonical_name;
  const matched = mdBody.toLowerCase().includes(query.toLowerCase());
  return { query, matched };
}

function lookupProductSlugForSourcePath(sourcePath: string): string | null {
  const db = getStudioDb();
  // sources.local_path is keyed on the same path we receive here.
  const row = db
    .prepare(
      `SELECT product_slug FROM sources WHERE local_path = ? ORDER BY id ASC LIMIT 1`
    )
    .get(sourcePath) as { product_slug: string } | undefined;
  if (row) return row.product_slug;

  // Fallback: derive slug from path layout
  // {category}/{vendor}/{line}/{slug}/source/{filename}
  const parts = sourcePath.split("/");
  const sourceIdx = parts.lastIndexOf("source");
  if (sourceIdx >= 1 && sourceIdx >= 4) {
    return parts[sourceIdx - 1];
  }
  return null;
}

interface SourcesYamlPostParseUpdate {
  sourcePath: string;
  sidecarRel: string;
  sidecarChars: number;
  reductoPages: number | null;
  reductoCredits: number | null;
  imagesKept: number;
  imagesFiltered: number;
  contentGrep: ContentGrepResult;
}

/**
 * After parse completes, update the per-product sources.yaml entry for this
 * PDF with the post-parse fields. Idempotent: replaces the entry by filename.
 *
 * If the source file lives at line- or category-scope (not under the
 * product's own dir), we still update the product's own sources.yaml because
 * that's where the studio's approval flow registered it. A future scope-aware
 * placement pass should split this so each scope's sources.yaml carries its
 * own entry, per the pull-sources skill — see TODO[scope-placement] below.
 */
async function updateSourcesYamlAfterParse(
  args: SourcesYamlPostParseUpdate
): Promise<void> {
  const slug = lookupProductSlugForSourcePath(args.sourcePath);
  if (!slug) return;
  const ctx = resolveProductContext(slug);
  if (!ctx) return;

  const yamlPath = path.join(ctx.product_dir, "sources.yaml");
  const filename = path.basename(args.sourcePath);
  const sidecarBasename = path.basename(args.sidecarRel);

  // Read current entry to preserve any fields the approve flow wrote.
  const existing = readSourcesYaml(yamlPath);
  const prior = existing?.sources.find((s) => s.filename === filename);

  appendSourceEntry({
    filePath: yamlPath,
    product: existing?.product ?? {
      slug: ctx.slug,
      vendor: ctx.vendor,
      category: ctx.category,
      product_line: ctx.product_line,
      name: ctx.canonical_name,
    },
    entry: {
      ...(prior ?? { filename, type: "other" }),
      filename,
      markdown_sidecar: sidecarBasename,
      markdown_sidecar_chars: args.sidecarChars,
      markdown_sidecar_source: "reducto",
      reducto_pages: args.reductoPages,
      reducto_credits: args.reductoCredits,
      reducto_images_kept: args.imagesKept,
      reducto_images_filtered: args.imagesFiltered,
      content_grep: args.contentGrep.query
        ? { query: args.contentGrep.query, matched: args.contentGrep.matched }
        : null,
    },
  });
}
