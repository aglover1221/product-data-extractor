import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { REPO_ROOT, walkDirs, parseProductRelDir } from "./repo-walk";
import { parseMarkdown } from "./safe-matter";
import { isPathInsideRoot } from "./path-security";

export type SourceScope = "product" | "line" | "category";

export type ManifestSource = {
  scope: SourceScope;
  local: string;
  local_extraction?: string;
  type: string;
  title?: string;
  url?: string;
  revision?: string;
  date?: string;
  pages?: number;
  audit_status?: string;
  audit_date?: string;
  notes?: string;
  resolved_path?: string;
  resolved_extraction_path?: string;
};

/** Classify a manifest `local:` value by counting leading `../` segments. */
export function classifyScope(localPath: string): SourceScope {
  const p = localPath.trim();
  if (p.startsWith("../../")) return "category";
  if (p.startsWith("../")) return "line";
  return "product";
}

/** Resolve a manifest path against the MD's directory; returns null if it escapes REPO_ROOT. */
export function resolveManifestPath(mdDir: string, localPath: string): string | null {
  if (!localPath) return null;
  const abs = path.resolve(mdDir, localPath);
  if (!isPathInsideRoot(REPO_ROOT, abs)) return null;
  return fs.existsSync(abs) ? abs : null;
}

/** Read the product MD's frontmatter `sources:` list and return a typed manifest with scopes resolved. */
export function readProductMdManifest(productDir: string, slug: string): ManifestSource[] | null {
  const fp = path.join(productDir, `${slug}.md`);
  if (!fs.existsSync(fp)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(fp, "utf8");
  } catch {
    return null;
  }
  const { data } = parseMarkdown(raw);
  const rows = Array.isArray(data.sources) ? data.sources : [];
  return rows.map((r: any) => {
    const local = String(r.local ?? "");
    const localExtraction = r.local_extraction ? String(r.local_extraction) : undefined;
    return {
      scope: classifyScope(local),
      local,
      local_extraction: localExtraction,
      type: String(r.type ?? "other"),
      title: r.title,
      url: r.url,
      revision: r.revision,
      date: r.date,
      pages: typeof r.pages === "number" ? r.pages : undefined,
      audit_status: r.audit_status,
      audit_date: r.audit_date,
      notes: r.notes,
      resolved_path: resolveManifestPath(productDir, local) ?? undefined,
      resolved_extraction_path: localExtraction
        ? resolveManifestPath(productDir, localExtraction) ?? undefined
        : undefined
    } satisfies ManifestSource;
  });
}

export type SourceFailure = {
  logical_type?: string;
  vendor_type_name?: string;
  reason?: string;
  detail?: string;
  queries_tried?: string[];
  urls_probed?: string[];
};

export type SourceRow = {
  filename: string;
  type: string;
  vendor_type_name?: string;
  title?: string;
  url?: string;
  sha256?: string;
  size_bytes?: number;
  fetched_at?: string;
  pdf_validated?: boolean;
  text_sidecar?: string;
  text_sidecar_lines?: number;
  content_grep?: { query?: string; matched?: boolean };
  notes?: string;
};

export type SourcesManifest = {
  product?: {
    name?: string;
    vendor?: string;
    category?: string;
    product_line?: string;
    slug?: string;
  };
  pulled_at?: string;
  pulled_by?: string;
  sources: SourceRow[];
  failures?: SourceFailure[];
};

export type SourcesSummary = {
  category: string;
  vendor: string;
  product_line: string;
  slug: string;
  product_dir: string;
  has_yaml: boolean;
  has_source_dir: boolean;
  source_files: { name: string; size: number; isText: boolean }[];
  total_bytes: number;
  manifest: SourcesManifest | null;
  /** Sources from the product MD's frontmatter — the canonical, exhaustive index per `_base.md` § "Manifest as canonical index". Includes own + line + category scope. Null when no `{slug}.md` exists yet (pre-Phase-4A backfill). */
  md_manifest: ManifestSource[] | null;
  failures_count: number;
  required_types_present: string[];
  required_types_missing: string[];
  required_types_rule: string;
  required_types_satisfied: boolean;
};

/** Per the pull-sources skill: vendor-specific required source-type rules. */
function requiredTypesForVendor(vendor: string): { rule: string; required: string[] } {
  const v = (vendor || "").toLowerCase();
  if (v === "hpe") return { rule: "spec-sheet only (HPE)", required: ["spec-sheet"] };
  if (v === "lenovo")
    return { rule: "tech-guide + spec-sheet (Lenovo)", required: ["tech-guide", "spec-sheet"] };
  if (v === "dell")
    return { rule: "tech-guide + spec-sheet (Dell)", required: ["tech-guide", "spec-sheet"] };
  return { rule: "spec-sheet (default)", required: ["spec-sheet"] };
}

/** When sources.yaml is absent (legacy Dell dirs), guess the logical type from a PDF's filename. */
function inferTypeFromFilename(name: string): string | null {
  const base = name.toLowerCase().replace(/\.(pdf|txt)$/, "");
  if (base === "technical-guide" || base === "tech-guide") return "tech-guide";
  if (base === "spec-sheet" || base === "quickspecs") return "spec-sheet";
  if (base === "product-guide") return "tech-guide";
  if (base === "platform-intro") return "platform-intro";
  if (base === "user-guide") return "user-guide";
  return null;
}

function coerceDates(v: any): any {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(coerceDates);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = coerceDates(val);
    return out;
  }
  return v;
}

export function readSourcesManifest(productDir: string): SourcesManifest | null {
  const fp = path.join(productDir, "sources.yaml");
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = coerceDates(yaml.load(raw)) as any;
    if (!parsed) return null;
    const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    const failures = Array.isArray(parsed.failures) ? parsed.failures : undefined;
    return {
      product: parsed.product,
      pulled_at: parsed.pulled_at,
      pulled_by: parsed.pulled_by,
      sources,
      failures
    };
  } catch (err) {
    console.error(`Failed to parse ${fp}:`, err);
    return null;
  }
}

function listSourceFiles(productDir: string): { name: string; size: number; isText: boolean }[] {
  const dir = path.join(productDir, "source");
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; size: number; isText: boolean }[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const fp = path.join(dir, e.name);
    let size = 0;
    try {
      size = fs.statSync(fp).size;
    } catch {
      // skip
    }
    out.push({ name: e.name, size, isText: e.name.endsWith(".txt") });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function summarize(absDir: string, relDir: string): SourcesSummary | null {
  const parsed = parseProductRelDir(relDir);
  if (!parsed) return null;
  const manifest = readSourcesManifest(absDir);
  const mdManifest = readProductMdManifest(absDir, parsed.slug);
  const sourceFiles = listSourceFiles(absDir);
  if (!manifest && !mdManifest && sourceFiles.length === 0) return null;

  const vendor = manifest?.product?.vendor ?? parsed.vendor;
  const { rule, required } = requiredTypesForVendor(vendor);
  // The MD manifest is the canonical index per `_base.md`; prefer its declared types.
  // Fall back to sources.yaml types, then to filename inference for legacy dirs.
  const declaredTypes = new Set<string>(
    mdManifest
      ? mdManifest.map((s) => s.type)
      : manifest
        ? (manifest.sources ?? []).map((s) => s.type)
        : sourceFiles
            .filter((f) => f.name.endsWith(".pdf"))
            .map((f) => inferTypeFromFilename(f.name))
            .filter((t): t is string => t !== null)
  );
  const present = required.filter((t) => declaredTypes.has(t));
  const missing = required.filter((t) => !declaredTypes.has(t));

  return {
    category: parsed.category,
    vendor: parsed.vendor,
    product_line: parsed.product_line,
    slug: parsed.slug,
    product_dir: absDir,
    has_yaml: manifest !== null,
    has_source_dir: sourceFiles.length > 0,
    source_files: sourceFiles,
    total_bytes: sourceFiles.reduce((acc, f) => acc + f.size, 0),
    manifest,
    md_manifest: mdManifest,
    failures_count: manifest?.failures?.length ?? 0,
    required_types_present: present,
    required_types_missing: missing,
    required_types_rule: rule,
    required_types_satisfied: missing.length === 0
  };
}

export function listSources(): SourcesSummary[] {
  const out: SourcesSummary[] = [];
  walkDirs(REPO_ROOT, (abs, rel) => {
    if (!rel) return;
    const summary = summarize(abs, rel);
    if (summary) out.push(summary);
  });
  return out.sort((a, b) =>
    (a.vendor + a.product_line + a.slug).localeCompare(b.vendor + b.product_line + b.slug)
  );
}

export function getSourcesForSlug(slug: string): SourcesSummary | null {
  const all = listSources();
  return all.find((s) => s.slug === slug) ?? null;
}

export function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
