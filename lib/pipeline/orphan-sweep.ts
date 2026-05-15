/**
 * Orphan sweep — pull-sources skill step 10:
 *
 *   "Before reporting done, sweep ${output_dir}/source/ for any file that did
 *    NOT make it into the sources.yaml `sources:` list. Delete orphans. The
 *    source/ directory's contents must match sources.yaml exactly — no
 *    stragglers from a failed retry."
 *
 * Studio's approve flow can leave orphans behind in two scenarios:
 *   - User manually drops a PDF into source/ outside the approve flow.
 *   - A failed approve retried at a different filename and the prior write
 *     wasn't cleaned up.
 *
 * This module provides:
 *   - listOrphans(productSlug)  → orphan file list (no side effects)
 *   - deleteOrphans(productSlug, { dryRun })  → returns plan / executes deletion
 *
 * Sidecars (`.md`) and Reducto image crops (`images/reducto/*.jpg`) are
 * NEVER considered orphans — they're managed by the parse phase, not the
 * approve flow. Only top-level files in source/ are subject to the sweep.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveProductContext } from "@/lib/pipeline/sources";
import { readSourcesYaml } from "@/lib/pipeline/sources-yaml";

export interface OrphanFile {
  /** Filename in {product_dir}/source/. */
  filename: string;
  absPath: string;
  fileSize: number;
}

export interface OrphanReport {
  productSlug: string;
  productDir: string;
  manifestFilenames: string[];
  orphans: OrphanFile[];
}

/**
 * List files in {product_dir}/source/ that aren't recorded in sources.yaml.
 * Recursive children (e.g. images/reducto/*) are intentionally excluded —
 * sidecars and crops are parse-phase artifacts.
 */
export function listOrphans(productSlug: string): OrphanReport {
  const ctx = resolveProductContext(productSlug);
  if (!ctx) {
    return {
      productSlug,
      productDir: "",
      manifestFilenames: [],
      orphans: [],
    };
  }
  const sourceDir = path.join(ctx.product_dir, "source");
  const manifest = readSourcesYaml(path.join(ctx.product_dir, "sources.yaml"));
  const manifestFilenames = (manifest?.sources ?? [])
    .map((s) => s.filename)
    .filter(Boolean) as string[];

  // Also include each entry's sidecar (markdown_sidecar) — those aren't
  // orphans even though they're not the primary `filename`.
  const allowed = new Set<string>(manifestFilenames);
  for (const s of manifest?.sources ?? []) {
    if (s.markdown_sidecar) allowed.add(s.markdown_sidecar);
  }

  const orphans: OrphanFile[] = [];
  if (!fs.existsSync(sourceDir)) {
    return {
      productSlug,
      productDir: ctx.product_dir,
      manifestFilenames,
      orphans,
    };
  }
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue; // skip images/, etc.
    if (entry.name.startsWith(".")) continue;
    if (allowed.has(entry.name)) continue;
    const abs = path.join(sourceDir, entry.name);
    let fileSize = 0;
    try {
      fileSize = fs.statSync(abs).size;
    } catch {
      // ignore
    }
    orphans.push({ filename: entry.name, absPath: abs, fileSize });
  }
  return {
    productSlug,
    productDir: ctx.product_dir,
    manifestFilenames,
    orphans,
  };
}

export interface DeleteOrphansResult {
  productSlug: string;
  deleted: string[];
  errors: { filename: string; error: string }[];
}

export function deleteOrphans(
  productSlug: string,
  options: { dryRun?: boolean } = {}
): DeleteOrphansResult {
  const report = listOrphans(productSlug);
  const result: DeleteOrphansResult = {
    productSlug,
    deleted: [],
    errors: [],
  };
  if (options.dryRun) return result;
  for (const orphan of report.orphans) {
    try {
      fs.unlinkSync(orphan.absPath);
      result.deleted.push(orphan.filename);
    } catch (err: any) {
      result.errors.push({
        filename: orphan.filename,
        error: err?.message ?? String(err),
      });
    }
  }
  return result;
}
