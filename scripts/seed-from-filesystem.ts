/**
 * Backfills the studio DB from existing filesystem state.
 *
 *   npm run studio:seed
 *
 * Wave 4 coverage:
 *   - sources: walk every product MD's `sources:` frontmatter; insert one
 *     `sources` row per (product_slug, scope, local_path).
 *   - parse_runs: for every `.md` sidecar that exists alongside a `.pdf`,
 *     insert a synthesized `status='completed'` row with mtime as started_at
 *     and a synthesized validation_json (computed by reading the sidecar).
 *
 * Idempotent: uses INSERT OR IGNORE on the unique (product_slug, scope, local_path)
 * constraint; for parse_runs we de-dupe on (source_path, output_md_path) by
 * deleting prior synthesized rows first.
 *
 * Future waves layered on top:
 *   - schemas: read schemas/*.md, schemas/overlays/*.md, register as v1.0
 *   - extraction_results: import existing extraction.json files tagged
 *     `imported-pre-studio` so they appear in run history
 */
import fs from "node:fs";
import path from "node:path";
import "@/lib/env";
import { env } from "@/lib/env";
import { ensureStudioSchema, getStudioDb } from "@/lib/db/client";
import { listAllSources } from "@/lib/pipeline/sources-fs";
import { listSources } from "@/lib/sources";
import { validateExistingSidecar } from "@/lib/pipeline/parse";

ensureStudioSchema();
const db = getStudioDb();

console.log("[seed] phase 1: backfilling sources from product MD manifests …");

const productSummaries = listSources();
const insertSource = db.prepare(
  `INSERT OR IGNORE INTO sources
     (product_slug, scope, doc_type, local_path, url, sha256, audit_status, page_count, approved_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

let sourcesInserted = 0;
let sourcesSkipped = 0;

const now = new Date().toISOString();
const tx = db.transaction(() => {
  for (const summary of productSummaries) {
    const md = summary.md_manifest ?? [];
    for (const row of md) {
      // Resolve to data-dir-relative path.
      const abs = row.resolved_path ?? path.resolve(summary.product_dir, row.local);
      const rel = path.relative(env.PRODUCT_MCP_DATA_DIR, abs).split(path.sep).join("/");
      const fmScope =
        row.scope === "product" ? "own" : row.scope; // sources.scope schema uses "own | line | category"
      const result = insertSource.run(
        summary.slug,
        fmScope,
        row.type ?? "other",
        rel,
        row.url ?? null,
        null,
        row.audit_status ?? null,
        row.pages ?? null,
        now
      );
      if (result.changes > 0) sourcesInserted++;
      else sourcesSkipped++;
    }
  }
});
tx();

console.log(
  `[seed]   inserted=${sourcesInserted} skipped=${sourcesSkipped} (already-present)`
);

console.log(
  "[seed] phase 2: synthesizing parse_runs for every existing .md sidecar …"
);

// Drop prior synthesized rows so re-running the seed is idempotent.
// We mark synthesized rows by a sentinel reducto_job_id of `seed:fs:<sourcePath>`.
const deleteSeeded = db.prepare(
  `DELETE FROM parse_runs WHERE reducto_job_id LIKE 'seed:fs:%'`
);
const removed = deleteSeeded.run();
console.log(`[seed]   removed ${removed.changes} prior synthesized parse_runs`);

const insertParseRun = db.prepare(
  `INSERT INTO parse_runs
     (source_id, source_path, reducto_job_id, status, output_md_path, validation_json, started_at, completed_at)
   VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`
);
const lookupSourceId = db.prepare(
  `SELECT id FROM sources WHERE local_path = ? LIMIT 1`
);

const fsSources = listAllSources({ fresh: true });
let parseRunsInserted = 0;
let parseRunsSkipped = 0;

const tx2 = db.transaction(() => {
  for (const src of fsSources) {
    if (!src.hasSidecar || !src.sidecarPath) {
      parseRunsSkipped++;
      continue;
    }
    const sidecarAbs = path.join(env.PRODUCT_MCP_DATA_DIR, src.sidecarPath);
    let validation: ReturnType<typeof validateExistingSidecar> | null = null;
    try {
      validation = validateExistingSidecar(sidecarAbs);
    } catch (err) {
      console.warn(
        `[seed]   could not validate ${src.sidecarPath}: ${(err as Error).message}`
      );
      continue;
    }
    const sourceIdRow = lookupSourceId.get(src.sourcePath) as
      | { id: number }
      | undefined;
    insertParseRun.run(
      sourceIdRow?.id ?? null,
      src.sourcePath,
      `seed:fs:${src.sourcePath}`,
      src.sidecarPath,
      JSON.stringify(validation),
      src.sidecarMtime ?? src.pdfMtime,
      src.sidecarMtime ?? src.pdfMtime
    );
    parseRunsInserted++;
  }
});
tx2();

console.log(
  `[seed]   inserted=${parseRunsInserted} skipped=${parseRunsSkipped} (no sidecar)`
);

console.log("[seed] done.");
