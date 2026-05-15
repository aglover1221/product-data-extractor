/**
 * Vendor option matrices — per-vendor cross-cutting compatibility docs that
 * span an entire category (today: GPUs only). Stored at
 * `{category}/{vendor}/_options/{filename}` so every product in that
 * (category, vendor) pair can reference them.
 *
 * Per the `pull-sources` skill § "Vendor cross-cutting option
 * matrices":
 *   - Refresh policy: pull if missing OR > 90 days old.
 *   - Per-product invocation triggers refresh on the first call of a fresh
 *     day for a given (vendor, category); studio surfaces this through the
 *     sources UI rather than per-product side-effects.
 *   - PDF + Reducto sidecar pair is the contract; no _options/sources.yaml.
 *   - Matrix-fetch failure does NOT mark per-product pulls incomplete.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { fetchAndValidatePdf } from "@/lib/pipeline/pdf-validation";

const STALE_THRESHOLD_DAYS = 90;

export interface OptionMatrixSpec {
  /** Lowercase vendor key matching path layout (`hpe`, `lenovo`). */
  vendor: string;
  /** Category the matrix applies to (today: `server`). */
  category: string;
  /** Stable filename — never ever rename. */
  filename: string;
  /** Vendor URL of the source PDF (HPE viewer URLs are handled by the two-step). */
  url: string;
  /** Human-readable title (used in UI, not on disk). */
  title: string;
  /** doc-id (informational; e.g. HPE c04123180, Lenovo lp0768). */
  doc_id?: string;
}

/**
 * Catalog. Add new (vendor, category) matrices here as cohorts surface.
 * Today: HPE NVIDIA + AMD accelerators; Lenovo ThinkSystem GPU summary.
 */
export const OPTION_MATRIX_CATALOG: OptionMatrixSpec[] = [
  {
    vendor: "hpe",
    category: "server",
    filename: "nvidia-accelerators-for-hpe.pdf",
    url: "https://www.hpe.com/psnow/doc/c04123180",
    title: "NVIDIA Accelerators for HPE QuickSpecs",
    doc_id: "c04123180",
  },
  {
    vendor: "hpe",
    category: "server",
    filename: "amd-accelerators-for-hpe.pdf",
    url: "https://www.hpe.com/psnow/doc/c04447905",
    title: "AMD Accelerators for HPE ProLiant Servers QuickSpecs",
    doc_id: "c04447905",
  },
  {
    vendor: "lenovo",
    category: "server",
    filename: "thinksystem-thinkagile-gpu-summary.pdf",
    url: "https://lenovopress.lenovo.com/lp0768.pdf",
    title: "ThinkSystem and ThinkAgile GPU Summary",
    doc_id: "lp0768",
  },
];

export interface OptionMatrixStatus extends OptionMatrixSpec {
  absPath: string;
  exists: boolean;
  ageDays: number | null;
  isStale: boolean;
  fileSize: number | null;
  hasSidecar: boolean;
}

function matrixDirAbs(vendor: string, category: string): string {
  return path.join(
    path.resolve(env.PRODUCT_MCP_DATA_DIR),
    category,
    vendor.toLowerCase(),
    "_options"
  );
}

function matrixAbsPath(spec: OptionMatrixSpec): string {
  return path.join(matrixDirAbs(spec.vendor, spec.category), spec.filename);
}

function sidecarPath(absPdf: string): string {
  return absPdf.replace(/\.pdf$/i, ".md");
}

export function statusOf(spec: OptionMatrixSpec): OptionMatrixStatus {
  const absPath = matrixAbsPath(spec);
  let exists = false;
  let fileSize: number | null = null;
  let ageDays: number | null = null;
  let isStale = false;
  try {
    const st = fs.statSync(absPath);
    exists = true;
    fileSize = st.size;
    ageDays = Math.floor((Date.now() - st.mtimeMs) / 86_400_000);
    isStale = ageDays > STALE_THRESHOLD_DAYS;
  } catch {
    // not present
    isStale = true;
  }
  return {
    ...spec,
    absPath,
    exists,
    fileSize,
    ageDays,
    isStale,
    hasSidecar: fs.existsSync(sidecarPath(absPath)),
  };
}

export function listMatrixStatuses(scope?: {
  vendor?: string;
  category?: string;
}): OptionMatrixStatus[] {
  return OPTION_MATRIX_CATALOG.filter(
    (s) =>
      (!scope?.vendor || s.vendor === scope.vendor.toLowerCase()) &&
      (!scope?.category || s.category === scope.category)
  ).map(statusOf);
}

export interface RefreshResult {
  spec: OptionMatrixSpec;
  ok: boolean;
  fileSize?: number;
  pageCount?: number;
  resolvedUrl?: string;
  error?: string;
}

/**
 * Fetch the matrix PDF and write it to disk. Honors the HPE downloadDoc
 * two-step + Akamai header set via fetchAndValidatePdf. Does NOT trigger a
 * Reducto parse — caller fans out to the parse phase if it wants a sidecar.
 *
 * Idempotent on success. Stale-or-missing matrices get refreshed; current
 * ones short-circuit unless `force` is set.
 */
export async function refreshIfStale(
  spec: OptionMatrixSpec,
  options: { force?: boolean } = {}
): Promise<RefreshResult> {
  const status = statusOf(spec);
  if (status.exists && !status.isStale && !options.force) {
    return { spec, ok: true, fileSize: status.fileSize ?? undefined };
  }

  const v = await fetchAndValidatePdf(spec.url);
  if (!v.ok || !v.bytes) {
    return { spec, ok: false, error: v.error ?? "fetch failed" };
  }

  const dir = matrixDirAbs(spec.vendor, spec.category);
  fs.mkdirSync(dir, { recursive: true });
  const target = matrixAbsPath(spec);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, v.bytes);
  fs.renameSync(tmp, target);

  return {
    spec,
    ok: true,
    fileSize: v.fileSize,
    pageCount: v.pageCount,
    resolvedUrl: v.resolvedUrl,
  };
}

/** Refresh every matrix in the catalog whose status is stale. */
export async function refreshAllStale(scope?: {
  vendor?: string;
  category?: string;
}): Promise<RefreshResult[]> {
  const candidates = listMatrixStatuses(scope).filter((s) => s.isStale);
  return Promise.all(candidates.map((s) => refreshIfStale(s)));
}
