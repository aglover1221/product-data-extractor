/**
 * Source acquisition phase — for one product, find authoritative source PDFs.
 *
 * Mirrors the `pull-sources` skill /
 * `acquire-sources/SKILL.md`. Single LLM call with web_search enabled returns
 * a list of candidate URLs. The orchestrator fetches each, validates it, and
 * stores it in `source_candidates` for the user to approve/reject. On approve
 * the candidate's bytes are written to disk under {product_dir}/source/, the
 * sources.yaml manifest is appended, and the product MD's frontmatter
 * sources: list is updated.
 *
 * Distinct from `lib/sources.ts` (manifest reader for already-acquired sources).
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { env } from "@/lib/env";
import { getStudioDb, ensureStudioSchema } from "@/lib/db/client";
import { searchWithTool, extractJson } from "@/lib/integrations/search";
import { fetchAndValidatePdf } from "@/lib/pipeline/pdf-validation";
import {
  appendSourceEntry,
  type SourcesYamlEntry,
} from "@/lib/pipeline/sources-yaml";
const PROMPTS_DIR = path.resolve(process.cwd(), "lib/prompts");

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface FindSourcesInput {
  productSlug: string;
}

export interface SourceCandidateRow {
  id: number;
  product_slug: string;
  scope: string;
  doc_type: string;
  url: string;
  status: string;
  file_size: number | null;
  page_count: number | null;
  sha256: string | null;
  fetched_at: string | null;
  error: string | null;
  // Hydrated from LLM payload but not stored (kept on the candidate JSON).
  title?: string | null;
  vendor_revision?: string | null;
  vendor_date?: string | null;
}

export interface FindSourcesResult {
  productSlug: string;
  candidatesAdded: number;
  candidates: SourceCandidateRow[];
  failures: Array<{ logical_type?: string; reason?: string; queries_tried?: string[] }>;
  notes: string;
}

interface RawLLMOutput {
  product_slug?: string;
  vendor?: string;
  candidates?: Array<{
    url?: string;
    doc_type?: string;
    scope?: string;
    title?: string | null;
    vendor_revision?: string | null;
    vendor_date?: string | null;
  }>;
  failures?: Array<{
    logical_type?: string;
    reason?: string;
    queries_tried?: string[];
  }>;
  source_urls_consulted?: string[];
  notes?: string;
}

// ----------------------------------------------------------------------------
// Product context
// ----------------------------------------------------------------------------

/**
 * Look up a product slug and resolve it to enough context (vendor, line,
 * category, canonical name) to drive the source-acquisition prompt.
 *
 * Order of resolution:
 *   1. discovered_products (most likely path post-discovery)
 *   2. existing sources rows (re-pull case)
 *   3. filesystem walk of PRODUCT_MCP_DATA_DIR
 */
export interface ProductContext {
  vendor: string;
  product_line: string;
  category: string;
  slug: string;
  canonical_name: string;
  product_dir: string; // absolute path
  product_md: string; // absolute path
}

export function resolveProductContext(productSlug: string): ProductContext | null {
  ensureStudioSchema();
  const db = getStudioDb();

  // 1. Try discovered_products
  const dp = db
    .prepare(
      `SELECT vendor, product_line, slug, marketing_name
       FROM discovered_products WHERE slug = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(productSlug) as any;
  if (dp) {
    // Need category — look at any discovered_products' parent discovery
    const parent = db
      .prepare(
        `SELECT d.raw_results
         FROM discovered_products dp
         JOIN discoveries d ON d.id = dp.discovery_id
         WHERE dp.slug = ?
         ORDER BY dp.id DESC LIMIT 1`
      )
      .get(productSlug) as any;
    let category = "";
    if (parent?.raw_results) {
      try {
        const raw = JSON.parse(parent.raw_results);
        const found = (raw.products ?? []).find(
          (p: any) => p.slug === productSlug && p.product_line === dp.product_line
        );
        category = found?.category ?? raw.category ?? "";
      } catch {
        // ignore
      }
    }
    if (!category) {
      // fall through to filesystem walk
    } else {
      const productDir = path.join(
        path.resolve(env.PRODUCT_MCP_DATA_DIR),
        category,
        dp.vendor,
        dp.product_line,
        dp.slug
      );
      return {
        vendor: dp.vendor,
        product_line: dp.product_line,
        category,
        slug: dp.slug,
        canonical_name: dp.marketing_name ?? dp.slug,
        product_dir: productDir,
        product_md: path.join(productDir, `${dp.slug}.md`),
      };
    }
  }

  // 2. Filesystem walk — find {category}/{vendor}/{line}/{slug}/ on disk
  const root = path.resolve(env.PRODUCT_MCP_DATA_DIR);
  const categories = [
    "server",
    "storage",
    "hci",
    "networking",
    "chassis",
    "software-defined-infrastructure",
  ];
  for (const category of categories) {
    const catDir = path.join(root, category);
    if (!fs.existsSync(catDir)) continue;
    for (const vendor of safeReaddir(catDir)) {
      const venDir = path.join(catDir, vendor);
      if (!fs.statSync(venDir).isDirectory()) continue;
      for (const line of safeReaddir(venDir)) {
        const lineDir = path.join(venDir, line);
        if (!fs.statSync(lineDir).isDirectory()) continue;
        const candidate = path.join(lineDir, productSlug);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return {
            vendor,
            product_line: line,
            category,
            slug: productSlug,
            canonical_name: readCanonicalNameFromMd(candidate, productSlug) ?? productSlug,
            product_dir: candidate,
            product_md: path.join(candidate, `${productSlug}.md`),
          };
        }
      }
    }
  }
  return null;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readCanonicalNameFromMd(productDir: string, slug: string): string | null {
  const mdPath = path.join(productDir, `${slug}.md`);
  if (!fs.existsSync(mdPath)) return null;
  try {
    const raw = fs.readFileSync(mdPath, "utf8");
    const m = raw.match(/^#\s+([^\n]+)/m);
    if (m) return m[1].trim().replace(/—.*$/, "").trim();
  } catch {
    // ignore
  }
  return null;
}

// ----------------------------------------------------------------------------
// findSources — main entry
// ----------------------------------------------------------------------------

export async function findSources(
  productSlug: string
): Promise<FindSourcesResult> {
  ensureStudioSchema();
  const db = getStudioDb();
  const ctx = resolveProductContext(productSlug);
  if (!ctx) {
    throw new Error(
      `findSources: product slug "${productSlug}" not found in DB or filesystem`
    );
  }

  const promptTemplate = fs.readFileSync(
    path.join(PROMPTS_DIR, "sources.md"),
    "utf8"
  );
  const userMessage = buildSourcesUserMessage(promptTemplate, ctx);

  const result = await searchWithTool(userMessage, { maxTokens: 8192 });
  let parsed: RawLLMOutput;
  try {
    parsed = extractJson<RawLLMOutput>(result.text);
  } catch (err: any) {
    throw new Error(
      `findSources: LLM did not return parseable JSON: ${err?.message ?? err}`
    );
  }

  const candidates = (parsed.candidates ?? []).filter((c) => c?.url);
  const insertCand = db.prepare(
    `INSERT INTO source_candidates
       (product_slug, scope, doc_type, url, status, fetched_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const updateCand = db.prepare(
    `UPDATE source_candidates
       SET file_size=?, page_count=?, sha256=?, status=?, error=?, fetched_at=?
     WHERE id=?`
  );

  const persisted: SourceCandidateRow[] = [];
  for (const c of candidates) {
    const url = String(c.url);
    const docType = String(c.doc_type ?? "other");
    const scope = String(c.scope ?? "own");
    const ins = insertCand.run(
      ctx.slug,
      scope,
      docType,
      url,
      "pending",
      null,
      null
    );
    const candId = Number(ins.lastInsertRowid);

    // Validate the URL right now — fetch + page count + sha256. We don't
    // persist the bytes (they're re-fetched on approve), just the metadata.
    try {
      const v = await fetchAndValidatePdf(url);
      const status = v.ok ? "pending" : "fetch-failed";
      updateCand.run(
        v.fileSize,
        v.pageCount ?? null,
        v.sha256 ?? null,
        status,
        v.error ?? null,
        new Date().toISOString(),
        candId
      );
      persisted.push({
        id: candId,
        product_slug: ctx.slug,
        scope,
        doc_type: docType,
        url,
        status,
        file_size: v.fileSize,
        page_count: v.pageCount ?? null,
        sha256: v.sha256 ?? null,
        fetched_at: new Date().toISOString(),
        error: v.error ?? null,
        title: c.title ?? null,
        vendor_revision: c.vendor_revision ?? null,
        vendor_date: c.vendor_date ?? null,
      });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      updateCand.run(
        0,
        null,
        null,
        "fetch-failed",
        msg,
        new Date().toISOString(),
        candId
      );
      persisted.push({
        id: candId,
        product_slug: ctx.slug,
        scope,
        doc_type: docType,
        url,
        status: "fetch-failed",
        file_size: 0,
        page_count: null,
        sha256: null,
        fetched_at: new Date().toISOString(),
        error: msg,
        title: c.title ?? null,
        vendor_revision: c.vendor_revision ?? null,
        vendor_date: c.vendor_date ?? null,
      });
    }
  }

  return {
    productSlug: ctx.slug,
    candidatesAdded: persisted.length,
    candidates: persisted,
    failures: parsed.failures ?? [],
    notes: parsed.notes ?? "",
  };
}

function buildSourcesUserMessage(
  promptTemplate: string,
  ctx: ProductContext
): string {
  const inputs = [
    `product_name: ${ctx.canonical_name}`,
    `vendor: ${displayVendor(ctx.vendor)}`,
    `category: ${ctx.category}`,
    `product_line_slug: ${ctx.product_line}`,
    `product_slug: ${ctx.slug}`,
  ].join("\n");
  return `${promptTemplate}\n\n---\n\n## This invocation\n\n${inputs}\n\nRun the steps above and return the JSON object now.`;
}

function displayVendor(vendor: string): string {
  if (vendor.toLowerCase() === "dell") return "Dell";
  if (vendor.toLowerCase() === "hpe") return "HPE";
  if (vendor.toLowerCase() === "lenovo") return "Lenovo";
  return vendor;
}

// ----------------------------------------------------------------------------
// approveCandidate — fetch + write + update sources.yaml + update MD frontmatter
// ----------------------------------------------------------------------------

export interface ApproveCandidateResult {
  ok: boolean;
  productSlug: string;
  localPath: string; // relative to PRODUCT_MCP_DATA_DIR
  sha256: string;
  pageCount: number;
  fileSize: number;
  error?: string;
}

const STABLE_FILENAMES: Record<string, string> = {
  "tech-guide": "technical-guide.pdf",
  "spec-sheet": "spec-sheet.pdf",
  "data-sheet": "data-sheet.pdf",
  "admin-guide": "admin-guide.pdf",
  "support-matrix": "support-matrix.pdf",
  "platform-intro": "platform-intro.pdf",
  brochure: "brochure.pdf",
  "solution-brief": "solution-brief.pdf",
  "program-doc": "program-doc.pdf",
  other: "other.pdf",
};

function stableFilenameFor(docType: string): string {
  return STABLE_FILENAMES[docType] ?? `${docType}.pdf`;
}

export async function approveCandidate(
  candidateId: number
): Promise<ApproveCandidateResult> {
  ensureStudioSchema();
  const db = getStudioDb();
  const cand = db
    .prepare(`SELECT * FROM source_candidates WHERE id = ?`)
    .get(candidateId) as any;
  if (!cand) throw new Error(`approveCandidate: candidate ${candidateId} not found`);
  if (cand.status === "approved") {
    throw new Error(`approveCandidate: candidate ${candidateId} already approved`);
  }

  const ctx = resolveProductContext(cand.product_slug);
  if (!ctx) {
    throw new Error(
      `approveCandidate: product slug "${cand.product_slug}" cannot be resolved`
    );
  }

  // Refuse writing into legacy /dell/ tree for non-Dell vendors per the
  // pull-sources skill. Catches misconfigured discoveries that would
  // otherwise pollute the legacy tree.
  if (
    ctx.vendor.toLowerCase() !== "dell" &&
    ctx.product_dir.split(path.sep).includes("dell")
  ) {
    throw new Error(
      `approveCandidate: refuse to write non-Dell product (vendor=${ctx.vendor}) into a path containing "dell/" — fix product_dir layout first`
    );
  }

  // Re-fetch + re-validate (we did not persist bytes from the discovery step).
  const v = await fetchAndValidatePdf(cand.url);
  if (!v.ok || !v.bytes) {
    db.prepare(
      `UPDATE source_candidates SET status='fetch-failed', error=?, fetched_at=? WHERE id=?`
    ).run(v.error ?? "fetch failed", new Date().toISOString(), candidateId);
    return {
      ok: false,
      productSlug: cand.product_slug,
      localPath: "",
      sha256: "",
      pageCount: 0,
      fileSize: 0,
      error: v.error ?? "fetch failed",
    };
  }

  const filename = stableFilenameFor(cand.doc_type);
  const sourceDir = sourceDirForScope(ctx, cand.scope);
  fs.mkdirSync(sourceDir, { recursive: true });
  const targetAbs = path.join(sourceDir, filename);
  const tmp = `${targetAbs}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, v.bytes);
  fs.renameSync(tmp, targetAbs);

  const dataDir = path.resolve(env.PRODUCT_MCP_DATA_DIR);
  const localPath = path.relative(dataDir, targetAbs);
  const fetchedAt = new Date().toISOString();

  // Insert into sources table
  db.prepare(
    `INSERT INTO sources
       (product_slug, scope, doc_type, local_path, url, sha256, audit_status, page_count, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, 'byte-identical', ?, ?)
     ON CONFLICT(product_slug, scope, local_path) DO UPDATE SET
       sha256=excluded.sha256,
       url=excluded.url,
       page_count=excluded.page_count,
       approved_at=excluded.approved_at`
  ).run(
    cand.product_slug,
    cand.scope,
    cand.doc_type,
    localPath,
    cand.url,
    v.sha256!,
    v.pageCount ?? null,
    fetchedAt
  );

  // Mark candidate approved
  db.prepare(
    `UPDATE source_candidates
       SET status='approved', file_size=?, page_count=?, sha256=?, fetched_at=?
     WHERE id=?`
  ).run(v.fileSize, v.pageCount ?? null, v.sha256!, fetchedAt, candidateId);

  // sources.yaml manifest — write at the scope where the file physically lives.
  // For 'own' scope, the manifest is in product_dir. For 'line' scope, the
  // manifest lives at the line directory's source/. For 'category' scope,
  // category directory's source/. Per pull-sources skill.
  const yamlPath = sourcesYamlPathForScope(ctx, cand.scope);
  const entry: SourcesYamlEntry = {
    filename,
    type: cand.doc_type,
    title: titleFromMaybe(cand) ?? null,
    url: cand.url,
    sha256: v.sha256!,
    size_bytes: v.fileSize,
    fetched_at: fetchedAt,
    pdf_validated: true,
    markdown_sidecar: null, // Reducto sidecar comes from the parse phase.
    markdown_sidecar_source: null,
    reducto_pages: v.pageCount ?? null,
    notes: "Approved via studio sources flow",
  };
  appendSourceEntry({
    filePath: yamlPath,
    product: {
      name: ctx.canonical_name,
      vendor: ctx.vendor,
      category: ctx.category,
      product_line: ctx.product_line,
      slug: ctx.slug,
    },
    entry,
  });

  // Update product MD frontmatter sources: list
  const localForMd = relForMd(cand.scope, filename);
  appendProductMdSource({
    mdPath: ctx.product_md,
    local: localForMd,
    docType: cand.doc_type,
    title: titleFromMaybe(cand),
    url: cand.url,
    pageCount: v.pageCount ?? null,
  });

  return {
    ok: true,
    productSlug: cand.product_slug,
    localPath,
    sha256: v.sha256!,
    pageCount: v.pageCount ?? 0,
    fileSize: v.fileSize,
  };
}

function titleFromMaybe(cand: any): string | null {
  // The DB row doesn't carry title (schema doesn't have a title column on
  // source_candidates), so we look at the URL filename as a poor-man's title
  // when the LLM-supplied title isn't passed through. Real title is derived
  // from the URL path.
  const url = String(cand.url ?? "");
  if (!url) return null;
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() ?? "";
    return decodeURIComponent(last) || null;
  } catch {
    return null;
  }
}

function sourcesYamlPathForScope(
  ctx: ProductContext,
  scope: string
): string {
  if (scope === "category") {
    return path.join(
      path.resolve(env.PRODUCT_MCP_DATA_DIR),
      ctx.category,
      ctx.vendor,
      "sources.yaml"
    );
  }
  if (scope === "line") {
    return path.join(
      path.resolve(env.PRODUCT_MCP_DATA_DIR),
      ctx.category,
      ctx.vendor,
      ctx.product_line,
      "sources.yaml"
    );
  }
  return path.join(ctx.product_dir, "sources.yaml");
}

export function sourceDirForScope(ctx: ProductContext, scope: string): string {
  const dataDir = path.resolve(env.PRODUCT_MCP_DATA_DIR);
  if (scope === "category") {
    return path.join(dataDir, ctx.category, ctx.vendor, "source");
  }
  if (scope === "line") {
    return path.join(dataDir, ctx.category, ctx.vendor, ctx.product_line, "source");
  }
  return path.join(ctx.product_dir, "source");
}

export function relForMd(scope: string, filename: string): string {
  if (scope === "category") return `../../source/${filename}`;
  if (scope === "line") return `../source/${filename}`;
  return `source/${filename}`;
}

// ----------------------------------------------------------------------------
// Product MD frontmatter mutation
// ----------------------------------------------------------------------------

interface AppendMdSourceInput {
  mdPath: string;
  local: string;
  docType: string;
  title: string | null;
  url: string;
  pageCount: number | null;
}

/**
 * Append a sources: row to the product MD's frontmatter. Idempotent: if a row
 * with the same `local:` already exists we update it in place rather than
 * appending a duplicate.
 *
 * Note: we re-write the frontmatter via js-yaml, then concatenate with the
 * original body. Atomic write: tmp + rename.
 */
function appendProductMdSource(input: AppendMdSourceInput): void {
  if (!fs.existsSync(input.mdPath)) {
    // Should not happen — discover/approve creates the skel, sources are added later.
    return;
  }
  const raw = fs.readFileSync(input.mdPath, "utf8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return;
  const fm = (yaml.load(fmMatch[1]) as Record<string, any>) ?? {};
  const body = fmMatch[2] ?? "";
  const sources: any[] = Array.isArray(fm.sources) ? fm.sources : [];
  const today = new Date().toISOString().slice(0, 10);
  const newRow: any = {
    local: input.local,
    type: input.docType,
    title: input.title ?? null,
    url: input.url,
    audit_status: "byte-identical",
    audit_date: today,
  };
  if (input.pageCount != null) newRow.pages = input.pageCount;
  // Strip null fields for cleanliness
  for (const k of Object.keys(newRow)) {
    if (newRow[k] == null) delete newRow[k];
  }
  const idx = sources.findIndex((s) => s?.local === input.local);
  if (idx >= 0) sources[idx] = { ...sources[idx], ...newRow };
  else sources.push(newRow);
  fm.sources = sources;
  fm.last_updated = today;

  const newFm = yaml.dump(fm, { lineWidth: 0, noRefs: true });
  const newDoc = `---\n${newFm.trimEnd()}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
  const tmp = `${input.mdPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, newDoc, "utf8");
  fs.renameSync(tmp, input.mdPath);
}

// ----------------------------------------------------------------------------
// reject + manual upload
// ----------------------------------------------------------------------------

export function rejectCandidate(candidateId: number): void {
  ensureStudioSchema();
  const db = getStudioDb();
  db.prepare(
    `UPDATE source_candidates SET status='rejected' WHERE id=?`
  ).run(candidateId);
}

export interface ManualUploadInput {
  productSlug: string;
  docType: string;
  scope?: string; // default 'own'
  filename?: string; // override stable filename
  bytes: Buffer;
  url?: string | null;
  title?: string | null;
}

export async function manualUpload(
  input: ManualUploadInput
): Promise<ApproveCandidateResult> {
  ensureStudioSchema();
  const db = getStudioDb();
  const ctx = resolveProductContext(input.productSlug);
  if (!ctx) {
    throw new Error(
      `manualUpload: product slug "${input.productSlug}" cannot be resolved`
    );
  }
  // Validate the bytes inline (don't re-fetch).
  const buf = input.bytes;
  if (buf.byteLength < 50 * 1024) {
    return {
      ok: false,
      productSlug: input.productSlug,
      localPath: "",
      sha256: "",
      pageCount: 0,
      fileSize: buf.byteLength,
      error: "file too small (< 50 KB)",
    };
  }
  if (
    buf[0] !== 0x25 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x44 ||
    buf[3] !== 0x46
  ) {
    return {
      ok: false,
      productSlug: input.productSlug,
      localPath: "",
      sha256: "",
      pageCount: 0,
      fileSize: buf.byteLength,
      error: "missing %PDF magic",
    };
  }
  const crypto = await import("node:crypto");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  let pageCount: number | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(buf);
    pageCount = parsed.numpages;
  } catch (err: any) {
    return {
      ok: false,
      productSlug: input.productSlug,
      localPath: "",
      sha256,
      pageCount: 0,
      fileSize: buf.byteLength,
      error: `pdf-parse failed: ${err?.message ?? err}`,
    };
  }

  const scope = input.scope ?? "own";
  const filename = input.filename ?? stableFilenameFor(input.docType);
  const sourceDir = sourceDirForScope(ctx, scope);
  fs.mkdirSync(sourceDir, { recursive: true });
  const targetAbs = path.join(sourceDir, filename);
  const tmp = `${targetAbs}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, targetAbs);

  const dataDir = path.resolve(env.PRODUCT_MCP_DATA_DIR);
  const localPath = path.relative(dataDir, targetAbs);
  const fetchedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO sources
       (product_slug, scope, doc_type, local_path, url, sha256, audit_status, page_count, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, 'byte-identical', ?, ?)
     ON CONFLICT(product_slug, scope, local_path) DO UPDATE SET
       sha256=excluded.sha256,
       url=excluded.url,
       page_count=excluded.page_count,
       approved_at=excluded.approved_at`
  ).run(
    input.productSlug,
    scope,
    input.docType,
    localPath,
    input.url ?? null,
    sha256,
    pageCount ?? null,
    fetchedAt
  );

  const yamlPath = sourcesYamlPathForScope(ctx, scope);
  appendSourceEntry({
    filePath: yamlPath,
    product: {
      name: ctx.canonical_name,
      vendor: ctx.vendor,
      category: ctx.category,
      product_line: ctx.product_line,
      slug: ctx.slug,
    },
    entry: {
      filename,
      type: input.docType,
      title: input.title ?? null,
      url: input.url ?? null,
      sha256,
      size_bytes: buf.byteLength,
      fetched_at: fetchedAt,
      pdf_validated: true,
      markdown_sidecar: null,
      markdown_sidecar_source: null,
      reducto_pages: pageCount ?? null,
      notes: "Uploaded manually via studio",
    },
  });

  appendProductMdSource({
    mdPath: ctx.product_md,
    local: relForMd(scope, filename),
    docType: input.docType,
    title: input.title ?? null,
    url: input.url ?? "",
    pageCount: pageCount ?? null,
  });

  return {
    ok: true,
    productSlug: input.productSlug,
    localPath,
    sha256,
    pageCount: pageCount ?? 0,
    fileSize: buf.byteLength,
  };
}

// ----------------------------------------------------------------------------
// Read helpers
// ----------------------------------------------------------------------------

export function listCandidatesForProduct(productSlug: string) {
  ensureStudioSchema();
  const db = getStudioDb();
  return db
    .prepare(
      `SELECT * FROM source_candidates WHERE product_slug = ? ORDER BY id DESC`
    )
    .all(productSlug) as any[];
}

export function listSourcesForProduct(productSlug: string) {
  ensureStudioSchema();
  const db = getStudioDb();
  return db
    .prepare(`SELECT * FROM sources WHERE product_slug = ? ORDER BY scope, doc_type`)
    .all(productSlug) as any[];
}

export function listProductsWithSourceStatus() {
  ensureStudioSchema();
  const db = getStudioDb();
  // Aggregate by product_slug across both sources + source_candidates
  return db
    .prepare(
      `WITH approved AS (
         SELECT product_slug, COUNT(*) AS approved_count
         FROM sources GROUP BY product_slug
       ),
       pending AS (
         SELECT product_slug, COUNT(*) AS pending_count
         FROM source_candidates WHERE status = 'pending' GROUP BY product_slug
       ),
       failed AS (
         SELECT product_slug, COUNT(*) AS failed_count
         FROM source_candidates WHERE status = 'fetch-failed' GROUP BY product_slug
       ),
       slugs AS (
         SELECT product_slug FROM sources
         UNION
         SELECT product_slug FROM source_candidates
       )
       SELECT s.product_slug,
              COALESCE(a.approved_count, 0) AS approved_count,
              COALESCE(p.pending_count, 0) AS pending_count,
              COALESCE(f.failed_count, 0) AS failed_count
       FROM slugs s
       LEFT JOIN approved a ON a.product_slug = s.product_slug
       LEFT JOIN pending  p ON p.product_slug = s.product_slug
       LEFT JOIN failed   f ON f.product_slug = s.product_slug
       ORDER BY s.product_slug`
    )
    .all() as any[];
}

export function getCandidate(candidateId: number) {
  ensureStudioSchema();
  const db = getStudioDb();
  return db
    .prepare(`SELECT * FROM source_candidates WHERE id = ?`)
    .get(candidateId) as any;
}
