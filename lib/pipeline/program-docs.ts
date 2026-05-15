/**
 * Program docs — cross-product T&Cs that apply to N products in the
 * portfolio (data-reduction guarantees, dedup guarantees, satisfaction
 * guarantees, etc.). Per the `pull-sources` skill § "Program
 * docs":
 *   - Place ONCE at the highest applicable scope (line or category) — the
 *     PDF + Reducto sidecar pair lives in exactly one physical location.
 *   - Register it in EACH eligible product MD's frontmatter `sources:`
 *     list via a relative `local:` path (`../source/...` for line, or
 *     `../../source/...` for category).
 *   - sources.yaml records the acquisition once at the file's scope; per-
 *     product sources.yaml is NOT touched for these.
 *   - Required-type coverage: never gates — always best-effort.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";
import { env } from "@/lib/env";
import { fetchAndValidatePdf } from "@/lib/pipeline/pdf-validation";
import { appendSourceEntry } from "@/lib/pipeline/sources-yaml";
import { resolveProductContext } from "@/lib/pipeline/sources";

export type ProgramScope = "line" | "category";

export interface EligibleProduct {
  /** Product slug (matches resolveProductContext input). */
  slug: string;
  /** Optional revision/eligibility note (e.g. "PowerStoreOS 4.0+"). */
  caveat?: string;
}

export interface ProgramDocSpec {
  /** Stable identifier for the catalog row. */
  key: string;
  /** Vendor's full T&C title (verbatim). */
  title: string;
  /** Authoritative URL of the PDF. */
  url: string;
  /** Stable on-disk filename — distinct programs get distinct names. */
  filename: string;
  /** doc type for the manifest row (always "program-doc"). */
  doc_type: "program-doc";
  /** Where the file is placed: line scope or category scope. */
  scope: ProgramScope;
  /** When scope=line: this is the line slug. When category: optional pin. */
  product_line?: string;
  category: string;
  vendor: string; // lowercase
  /** Concrete eligible-products list per the T&C body itself. */
  eligible_products: EligibleProduct[];
  /** Free-text marketing-vs-T&C warning if the source is brochure-grade. */
  notes?: string;
}

/**
 * Catalog. Add a new entry when a vendor publishes a new program T&C; the
 * skill explicitly says "verify it's an actual T&C (rev/effective date, legal
 * language) vs. a marketing brochure." Brochures get pulled too but with a
 * notes flag.
 */
export const PROGRAM_DOC_CATALOG: ProgramDocSpec[] = [
  {
    key: "powerstore-powermax-dr-guarantee",
    title: "Future-Proof Data Reduction Guarantee Terms and Conditions",
    url: "https://www.delltechnologies.com/asset/en-us/products/storage/legal-pricing/future-proof-dr-guarantee-tc.pdf",
    filename: "data-reduction-guarantee.pdf",
    doc_type: "program-doc",
    scope: "category",
    category: "storage",
    vendor: "dell",
    eligible_products: [
      { slug: "powerstore-500t", caveat: "PowerStoreOS 4.0+" },
      { slug: "powerstore-1200t", caveat: "PowerStoreOS 4.0+" },
      { slug: "powerstore-3200t", caveat: "PowerStoreOS 4.0+" },
      { slug: "powerstore-5200t", caveat: "PowerStoreOS 4.0+" },
      { slug: "powerstore-9200t", caveat: "PowerStoreOS 4.0+" },
      { slug: "powermax-2500", caveat: "PowerMaxOS 10.1+" },
      { slug: "powermax-8500", caveat: "PowerMaxOS 10.1+" },
    ],
  },
  {
    key: "powerscale-dr-guarantee",
    title: "PowerScale Data Reduction Guarantee Terms and Conditions",
    url: "https://www.delltechnologies.com/asset/en-us/products/storage/legal-pricing/dr-guarantee-tc-powerscale.pdf",
    filename: "data-reduction-guarantee.pdf",
    doc_type: "program-doc",
    scope: "line",
    category: "storage",
    vendor: "dell",
    product_line: "powerscale",
    eligible_products: [
      // PowerScale F-series + H-series + A-series — populate as products land.
    ],
  },
  {
    key: "powerflex-dr-guarantee",
    title: "PowerFlex Future-Proof Data Reduction Guarantee Program Terms",
    url: "https://www.delltechnologies.com/asset/en-us/products/storage/industry-market/powerflex-terms-conditions-future-proof-data-reduction-guarantee-program.pdf",
    filename: "data-reduction-guarantee.pdf",
    doc_type: "program-doc",
    scope: "line",
    category: "software-defined-infrastructure",
    vendor: "dell",
    product_line: "powerflex",
    eligible_products: [],
  },
  {
    key: "cyber-resilience-dedup-guarantee",
    title:
      "Cyber Resilience Deduplication Guarantee Terms and Conditions (Future-Proof)",
    url: "https://www.delltechnologies.com/asset/en-us/products/storage/briefs-summaries/cyber-resilience-deduplication-guarantee-terms-and-conditions-future-proof-brief.pdf",
    filename: "dedup-guarantee.pdf",
    doc_type: "program-doc",
    scope: "line",
    category: "storage",
    vendor: "dell",
    product_line: "powerprotect-data-domain",
    eligible_products: [
      // PowerProtect DD models with cyber-recovery vault — populate as products land.
    ],
  },
  {
    key: "satisfaction-guarantee",
    title: "Dell Technologies Satisfaction Guarantee Terms and Conditions",
    url: "https://www.delltechnologies.com/asset/en-us/products/storage/briefs-summaries/dell-technologies-satisfaction-guarantee-terms-and-conditions.pdf",
    filename: "satisfaction-guarantee.pdf",
    doc_type: "program-doc",
    scope: "category",
    category: "storage",
    vendor: "dell",
    eligible_products: [
      // Dell storage / DPS / networking broadly. Eligibility is broad enough
      // that we leave the list empty; user picks which products to register
      // in the distribute UI.
    ],
  },
];

// ----------------------------------------------------------------------------
// Path helpers
// ----------------------------------------------------------------------------

const DATA_DIR = path.resolve(env.PRODUCT_MCP_DATA_DIR);

export function programDocAbsPath(spec: ProgramDocSpec): string {
  if (spec.scope === "category") {
    return path.join(
      DATA_DIR,
      spec.category,
      spec.vendor.toLowerCase(),
      "source",
      spec.filename
    );
  }
  if (!spec.product_line) {
    throw new Error(`scope=line requires product_line on ${spec.key}`);
  }
  return path.join(
    DATA_DIR,
    spec.category,
    spec.vendor.toLowerCase(),
    spec.product_line,
    "source",
    spec.filename
  );
}

export function programDocSourcesYamlPath(spec: ProgramDocSpec): string {
  if (spec.scope === "category") {
    return path.join(
      DATA_DIR,
      spec.category,
      spec.vendor.toLowerCase(),
      "sources.yaml"
    );
  }
  return path.join(
    DATA_DIR,
    spec.category,
    spec.vendor.toLowerCase(),
    spec.product_line!,
    "sources.yaml"
  );
}

/** Manifest-relative path the product MD's frontmatter sources: row uses. */
export function manifestRelPathForProgramDoc(
  spec: ProgramDocSpec,
  productSlug: string
): string {
  // Resolving against the product's MD file location.
  const ctx = resolveProductContext(productSlug);
  if (!ctx) {
    throw new Error(`Cannot resolve product slug: ${productSlug}`);
  }
  const abs = programDocAbsPath(spec);
  const rel = path.relative(ctx.product_dir, abs);
  // Force forward slashes for portability.
  return rel.split(path.sep).join("/");
}

// ----------------------------------------------------------------------------
// Distribution flow
// ----------------------------------------------------------------------------

export interface DistributeResult {
  programKey: string;
  fetchedFresh: boolean;
  pdfAbsPath: string;
  pdfRelPath: string;
  pdfSize?: number;
  pdfPages?: number;
  productsRegistered: string[];
  productsSkipped: { slug: string; reason: string }[];
  error?: string;
}

/**
 * Distribute one program doc per the skill workflow:
 *   1. Fetch PDF once at chosen scope (skip if already on disk and not forced).
 *   2. Append a row to the scope's sources.yaml.
 *   3. For every eligible product, append a `sources:` row to its product MD
 *      frontmatter pointing at the same physical PDF via relative path.
 *
 * Idempotent: re-running on a fresh disk replays only the missing pieces.
 */
export async function distributeProgramDoc(
  spec: ProgramDocSpec,
  options: { force?: boolean; productSlugs?: string[] } = {}
): Promise<DistributeResult> {
  const result: DistributeResult = {
    programKey: spec.key,
    fetchedFresh: false,
    pdfAbsPath: programDocAbsPath(spec),
    pdfRelPath: path.relative(DATA_DIR, programDocAbsPath(spec)),
    productsRegistered: [],
    productsSkipped: [],
  };

  // 1. Fetch
  const target = result.pdfAbsPath;
  const present = fs.existsSync(target);
  if (!present || options.force) {
    const v = await fetchAndValidatePdf(spec.url);
    if (!v.ok || !v.bytes) {
      result.error = v.error ?? "fetch failed";
      return result;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, v.bytes);
    fs.renameSync(tmp, target);
    result.fetchedFresh = true;
    result.pdfSize = v.fileSize;
    result.pdfPages = v.pageCount;
  } else {
    const st = fs.statSync(target);
    result.pdfSize = st.size;
  }

  // 2. Append to scope's sources.yaml
  const yamlPath = programDocSourcesYamlPath(spec);
  appendSourceEntry({
    filePath: yamlPath,
    entry: {
      filename: spec.filename,
      type: "program-doc",
      vendor_type_name: spec.title,
      title: spec.title,
      url: spec.url,
      pdf_validated: true,
      size_bytes: result.pdfSize ?? null,
      reducto_pages: null, // populated by parse phase
      markdown_sidecar: null,
      markdown_sidecar_source: null,
      notes: spec.notes ?? null,
      content_grep: null,
    },
  });

  // 3. Register in each eligible product MD's frontmatter sources: list
  const slugs =
    options.productSlugs ??
    spec.eligible_products.map((p) => p.slug);
  for (const slug of slugs) {
    try {
      const ok = registerProgramDocOnProductMd(spec, slug);
      if (ok) result.productsRegistered.push(slug);
      else
        result.productsSkipped.push({
          slug,
          reason: "product MD not found or already registered",
        });
    } catch (err: any) {
      result.productsSkipped.push({
        slug,
        reason: err?.message ?? String(err),
      });
    }
  }

  return result;
}

/**
 * Append a `sources:` row to the product MD frontmatter pointing at the
 * program-doc's PDF + sidecar via relative paths. Returns true if the row
 * was newly added; false if it already existed.
 */
export function registerProgramDocOnProductMd(
  spec: ProgramDocSpec,
  productSlug: string
): boolean {
  const ctx = resolveProductContext(productSlug);
  if (!ctx) return false;
  if (!fs.existsSync(ctx.product_md)) return false;

  const pdfRel = manifestRelPathForProgramDoc(spec, productSlug);
  const sidecarRel = pdfRel.replace(/\.pdf$/i, ".md");

  const raw = fs.readFileSync(ctx.product_md, "utf8");
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as any;
  const list: any[] = Array.isArray(fm.sources) ? fm.sources : [];
  const already = list.some((r) => r?.local === pdfRel);
  if (already) return false;

  list.push({
    type: "program-doc",
    title: spec.title,
    url: spec.url,
    local: pdfRel,
    local_extraction: sidecarRel,
    audit_status: "byte-identical",
    notes:
      spec.notes ??
      "Cross-product T&C; PDF lives at higher-scope source/, registered here via relative manifest path.",
  });
  fm.sources = list;

  // Re-emit the MD with updated frontmatter. matter.stringify writes valid YAML.
  const out = matter.stringify(parsed.content, fm);

  // Atomic write
  const tmp = `${ctx.product_md}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, out, "utf8");
  fs.renameSync(tmp, ctx.product_md);
  return true;
}

// ----------------------------------------------------------------------------
// Status / list helpers (UI)
// ----------------------------------------------------------------------------

export interface ProgramDocStatus extends ProgramDocSpec {
  presentOnDisk: boolean;
  sidecarPresent: boolean;
  fileSize: number | null;
  ageDays: number | null;
}

export function listProgramDocStatuses(): ProgramDocStatus[] {
  return PROGRAM_DOC_CATALOG.map((spec) => {
    const abs = programDocAbsPath(spec);
    let presentOnDisk = false;
    let fileSize: number | null = null;
    let ageDays: number | null = null;
    try {
      const st = fs.statSync(abs);
      presentOnDisk = true;
      fileSize = st.size;
      ageDays = Math.floor((Date.now() - st.mtimeMs) / 86_400_000);
    } catch {
      /* not present */
    }
    const sidecarAbs = abs.replace(/\.pdf$/i, ".md");
    return {
      ...spec,
      presentOnDisk,
      sidecarPresent: fs.existsSync(sidecarAbs),
      fileSize,
      ageDays,
    };
  });
}
