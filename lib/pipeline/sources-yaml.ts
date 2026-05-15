/**
 * sources.yaml reader/writer.
 *
 * Each product directory has a sources.yaml acquisition manifest at the same
 * scope as its source/. This module provides the typed read/write/append
 * helpers used by the source-acquisition phase. Format matches the
 * pull-sources skill output (see e.g. server/dell/poweredge/r770/sources.yaml).
 *
 * Atomic write: tmp file + rename.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export interface SourcesYamlEntry {
  filename: string;
  type: string;
  vendor_type_name?: string | null;
  title?: string | null;
  url?: string | null;
  vendor_revision?: string | null;
  vendor_date?: string | null;
  sha256?: string | null;
  size_bytes?: number | null;
  fetched_at?: string | null;
  pdf_validated?: boolean | null;
  markdown_sidecar?: string | null;
  markdown_sidecar_chars?: number | null;
  markdown_sidecar_source?: string | null;
  reducto_pages?: number | null;
  reducto_credits?: number | null;
  reducto_images_kept?: number | null;
  reducto_images_filtered?: number | null;
  text_sidecar?: string | null;
  content_grep?: { query?: string; matched?: boolean | null } | null;
  notes?: string | null;
}

export interface SourcesYamlFailure {
  logical_type?: string | null;
  reason?: string | null;
  queries_tried?: string[] | null;
}

export interface SourcesYamlFile {
  product?: {
    name?: string;
    vendor?: string;
    category?: string;
    product_line?: string;
    slug?: string;
  };
  pulled_at?: string;
  pulled_by?: string;
  sources: SourcesYamlEntry[];
  failures?: SourcesYamlFailure[];
}

export function readSourcesYaml(filePath: string): SourcesYamlFile | null {
  if (!fs.existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const parsed = yaml.load(raw) as SourcesYamlFile | null | undefined;
  if (!parsed) return null;
  if (!Array.isArray(parsed.sources)) parsed.sources = [];
  return parsed;
}

/** Atomic write — tmp file + rename. */
export function writeSourcesYaml(filePath: string, file: SourcesYamlFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = yaml.dump(file, { lineWidth: 0, noRefs: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Append a source entry to sources.yaml, creating the file if absent.
 * If an entry with the same filename exists, it is replaced.
 *
 * The "manifest as truth" project convention means sources.yaml is the audit
 * record; entries are append-only in normal flow but we replace-on-collision
 * to keep idempotency for the approve route.
 */
export function appendSourceEntry({
  filePath,
  product,
  entry,
}: {
  filePath: string;
  product?: SourcesYamlFile["product"];
  entry: SourcesYamlEntry;
}): SourcesYamlFile {
  const existing = readSourcesYaml(filePath) ?? {
    product,
    pulled_at: new Date().toISOString(),
    pulled_by: "studio-wave-6",
    sources: [],
  };
  if (product && !existing.product) existing.product = product;
  if (!existing.pulled_at) existing.pulled_at = new Date().toISOString();
  if (!existing.pulled_by) existing.pulled_by = "studio-wave-6";

  const idx = existing.sources.findIndex((s) => s.filename === entry.filename);
  if (idx >= 0) {
    existing.sources[idx] = { ...existing.sources[idx], ...entry };
  } else {
    existing.sources.push(entry);
  }

  writeSourcesYaml(filePath, existing);
  return existing;
}
