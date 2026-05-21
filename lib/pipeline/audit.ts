/**
 * Audit phase — cross-product / cross-MD consistency checks.
 *
 * Wave 7. Pure code, no LLM.
 *
 * Mirrors the `audit-portfolio` skill Checks A–M, scoped to the
 * cross-MD checks the per-product verifier can't do:
 *   - product line MD ↔ on-disk product directories (Checks A, B, D)
 *   - cross-link resolution: `parent_product_line`, `base_server`,
 *     `runs_on_nodes`, `predecessor`, `successor`,
 *     `bundled_target_storage`, `installs_in_chassis_slug` (Check C)
 *   - frontmatter category / product_line consistency (Checks E, F)
 *   - manifest exhaustiveness + path resolution (Checks I, J)
 *   - orphan PDFs in any source/ tree (Check K)
 *   - cross-scope SHA-256 duplicates (Check L)
 *
 * Design notes:
 *   - Single tree walk; cache resolved cross-link paths in-memory per run.
 *   - Atomic results: every issue produces one row in a sub-audit's `results`
 *     array with status / subject / message / fixHint.
 *   - Filterable in the UI by status (pass / fail / warn).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { parseMarkdown } from "@/lib/safe-matter";
import { isPathInsideRoot } from "@/lib/path-security";

const DATA_DIR = path.resolve(env.PRODUCT_MCP_DATA_DIR);

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "warn";

export interface CheckResult {
  status: CheckStatus;
  subject: string; // path or product slug — the affected file
  message: string;
  fixHint?: string;
}

export interface SubAuditReport {
  checkName: string;
  description: string;
  results: CheckResult[];
  pass: number;
  fail: number;
  warn: number;
}

export interface AuditReport {
  scope: { category?: string };
  generatedAt: string;
  durationMs: number;
  categories: string[];
  totals: { pass: number; fail: number; warn: number };
  byCategory: Record<string, { pass: number; fail: number; warn: number }>;
  subAudits: SubAuditReport[];
}

// ----------------------------------------------------------------------------
// Filesystem walk
//
// Layout: {category}/{vendor}/{product-line}/{product-slug}/{slug}.md
//                                          /{product-line}.md
// Plus optional source/ at category, line, and product scopes.
// ----------------------------------------------------------------------------

const KNOWN_CATEGORIES = new Set([
  "server",
  "storage",
  "hci",
  "networking",
  "chassis",
  "software-defined-infrastructure",
]);

interface ProductMd {
  category: string;
  vendor: string;
  productLine: string;
  slug: string;
  productDir: string; // absolute
  mdPath: string; // absolute path to {slug}.md
  frontmatter: Record<string, any>;
  exists: boolean;
}

interface ProductLineMd {
  category: string;
  vendor: string;
  productLine: string;
  lineDir: string; // absolute
  mdPath: string; // absolute path to {product-line}.md
  frontmatter: Record<string, any>;
  exists: boolean; // true if the MD file is present
  productSlugsOnDisk: string[];
}

function safeReadFrontmatter(p: string): Record<string, any> | null {
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = parseMarkdown(raw);
    return parsed.data ?? {};
  } catch {
    return null;
  }
}

function listSubdirs(absDir: string): string[] {
  if (!fs.existsSync(absDir)) return [];
  try {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "source")
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listFilesInDir(absDir: string, exts: string[]): string[] {
  if (!fs.existsSync(absDir)) return [];
  try {
    return fs
      .readdirSync(absDir, { withFileTypes: true })
      .filter((d) => d.isFile() && exts.some((e) => d.name.toLowerCase().endsWith(e)))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

interface PortfolioWalk {
  productLines: ProductLineMd[];
  products: ProductMd[];
  /** Every source/ directory under in-scope tree, as absolute paths. */
  sourceDirs: string[];
}

function categoriesInScope(scope?: { category?: string }): string[] {
  if (scope?.category) {
    return [scope.category];
  }
  return Array.from(KNOWN_CATEGORIES).filter((c) =>
    fs.existsSync(path.join(DATA_DIR, c))
  );
}

function walkPortfolio(scope?: { category?: string }): PortfolioWalk {
  const categories = categoriesInScope(scope);
  const productLines: ProductLineMd[] = [];
  const products: ProductMd[] = [];
  const sourceDirs: string[] = [];

  for (const category of categories) {
    const catDir = path.join(DATA_DIR, category);
    if (!fs.existsSync(catDir)) continue;

    // Category-scope source/
    const catSource = path.join(catDir, "source");
    if (fs.existsSync(catSource)) sourceDirs.push(catSource);

    const vendors = listSubdirs(catDir);
    for (const vendor of vendors) {
      const vendorDir = path.join(catDir, vendor);
      const lines = listSubdirs(vendorDir);
      for (const productLine of lines) {
        const lineDir = path.join(vendorDir, productLine);
        const lineMdPath = path.join(lineDir, `${productLine}.md`);
        const lineFm = safeReadFrontmatter(lineMdPath);

        // Line-scope source/
        const lineSource = path.join(lineDir, "source");
        if (fs.existsSync(lineSource)) sourceDirs.push(lineSource);

        const slugs = listSubdirs(lineDir);
        productLines.push({
          category,
          vendor,
          productLine,
          lineDir,
          mdPath: lineMdPath,
          frontmatter: lineFm ?? {},
          exists: lineFm !== null,
          productSlugsOnDisk: slugs,
        });

        for (const slug of slugs) {
          const productDir = path.join(lineDir, slug);
          const mdPath = path.join(productDir, `${slug}.md`);
          const fm = safeReadFrontmatter(mdPath);

          // Product-scope source/
          const prodSource = path.join(productDir, "source");
          if (fs.existsSync(prodSource)) sourceDirs.push(prodSource);

          products.push({
            category,
            vendor,
            productLine,
            slug,
            productDir,
            mdPath,
            frontmatter: fm ?? {},
            exists: fm !== null,
          });
        }
      }
    }
  }

  return { productLines, products, sourceDirs };
}

// ----------------------------------------------------------------------------
// Sub-audits
// ----------------------------------------------------------------------------

function relFromData(absPath: string): string {
  return path.relative(DATA_DIR, absPath);
}

function tally(results: CheckResult[]): Pick<SubAuditReport, "pass" | "fail" | "warn"> {
  let pass = 0,
    fail = 0,
    warn = 0;
  for (const r of results) {
    if (r.status === "pass") pass++;
    else if (r.status === "fail") fail++;
    else warn++;
  }
  return { pass, fail, warn };
}

/** Check A + B + D + E + F: product-line / product directory ↔ MD consistency. */
export function auditProductLineConsistency(
  walk: PortfolioWalk
): SubAuditReport {
  const results: CheckResult[] = [];

  // Build product index by category+line
  const productsByLine = new Map<string, ProductMd[]>();
  for (const p of walk.products) {
    const key = `${p.category}/${p.vendor}/${p.productLine}`;
    if (!productsByLine.has(key)) productsByLine.set(key, []);
    productsByLine.get(key)!.push(p);
  }

  for (const line of walk.productLines) {
    const subject = relFromData(line.mdPath);

    // A: product line MD presence
    if (!line.exists && line.productSlugsOnDisk.length > 0) {
      results.push({
        status: "fail",
        subject,
        message: `Product directory has ${line.productSlugsOnDisk.length} product MD${line.productSlugsOnDisk.length === 1 ? "" : "s"} but no \`${line.productLine}.md\` product line MD.`,
        fixHint: `Bootstrap the product line MD: write ${subject}.`,
      });
      continue;
    }
    if (!line.exists) {
      // No products and no MD: nothing to flag (degenerate empty dir, treat as pass).
      results.push({
        status: "pass",
        subject,
        message: `Empty product line directory (no products, no MD).`,
      });
      continue;
    }

    // E: category frontmatter matches directory
    if (line.frontmatter.category && line.frontmatter.category !== line.category) {
      results.push({
        status: "fail",
        subject,
        message: `Frontmatter \`category: ${line.frontmatter.category}\` does not match directory category \`${line.category}\`.`,
        fixHint: `Update frontmatter category to \`${line.category}\` or move the MD.`,
      });
    }

    // F: product_line frontmatter matches directory
    if (
      line.frontmatter.product_line &&
      line.frontmatter.product_line !== line.productLine
    ) {
      results.push({
        status: "fail",
        subject,
        message: `Frontmatter \`product_line: ${line.frontmatter.product_line}\` does not match directory \`${line.productLine}\`.`,
        fixHint: `Update frontmatter product_line to \`${line.productLine}\` or move the MD.`,
      });
    }

    // B: products: list ↔ on-disk slugs
    const declaredProducts: string[] = Array.isArray(line.frontmatter.products)
      ? line.frontmatter.products.map((s: any) => String(s))
      : [];
    const onDiskSlugs = line.productSlugsOnDisk;
    const declared = new Set(declaredProducts);
    const onDisk = new Set(onDiskSlugs);

    const declaredButMissing = [...declared].filter((s) => !onDisk.has(s));
    const onDiskButUndeclared = [...onDisk].filter((s) => !declared.has(s));

    if (declaredButMissing.length > 0) {
      results.push({
        status: "fail",
        subject,
        message: `Frontmatter \`products:\` lists ${declaredButMissing.length} slug${declaredButMissing.length === 1 ? "" : "s"} with no on-disk directory: ${declaredButMissing.join(", ")}.`,
        fixHint: `Either remove the slug from \`products:\` or create the missing product directory.`,
      });
    }
    if (onDiskButUndeclared.length > 0) {
      results.push({
        status: "fail",
        subject,
        message: `On-disk product${onDiskButUndeclared.length === 1 ? "" : "s"} not listed in \`products:\`: ${onDiskButUndeclared.join(", ")}.`,
        fixHint: `Add the slug${onDiskButUndeclared.length === 1 ? "" : "s"} to the product line MD's \`products:\` list.`,
      });
    }

    // D: duplicate slugs within a product line — onDiskSlugs is from listSubdirs which dedupes
    // by filesystem; collisions only happen at the case-sensitive level on case-insensitive FS.
    const seen = new Map<string, number>();
    for (const s of onDiskSlugs) {
      const k = s.toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const [k, n] of seen) {
      if (n > 1) {
        results.push({
          status: "fail",
          subject,
          message: `Duplicate product slug (case-insensitive) within product line: \`${k}\` appears ${n} times.`,
          fixHint: `Rename one of the directories to a unique slug.`,
        });
      }
    }

    if (
      declaredButMissing.length === 0 &&
      onDiskButUndeclared.length === 0 &&
      (!line.frontmatter.category || line.frontmatter.category === line.category) &&
      (!line.frontmatter.product_line || line.frontmatter.product_line === line.productLine)
    ) {
      results.push({
        status: "pass",
        subject,
        message: `Product line MD consistent: ${onDiskSlugs.length} product${onDiskSlugs.length === 1 ? "" : "s"} on disk, declared list matches.`,
      });
    }
  }

  // Per-product E/F + parent_product_line presence
  for (const p of walk.products) {
    const subject = relFromData(p.mdPath);
    if (!p.exists) {
      // Product directory exists but no MD — flagged in orphans audit; skip here to avoid double-counting.
      continue;
    }
    let ok = true;
    if (p.frontmatter.category && p.frontmatter.category !== p.category) {
      results.push({
        status: "fail",
        subject,
        message: `Frontmatter \`category: ${p.frontmatter.category}\` does not match directory category \`${p.category}\`.`,
        fixHint: `Update frontmatter category to \`${p.category}\` or move the MD.`,
      });
      ok = false;
    }
    if (
      p.frontmatter.product_line &&
      p.frontmatter.product_line !== p.productLine
    ) {
      results.push({
        status: "fail",
        subject,
        message: `Frontmatter \`product_line: ${p.frontmatter.product_line}\` does not match directory \`${p.productLine}\`.`,
        fixHint: `Update frontmatter product_line to \`${p.productLine}\` or move the MD.`,
      });
      ok = false;
    }
    if (ok) {
      results.push({
        status: "pass",
        subject,
        message: `Product MD frontmatter consistent with directory.`,
      });
    }
  }

  return {
    checkName: "product-line-consistency",
    description:
      "Product line MD presence, frontmatter ↔ directory consistency, products: list ↔ on-disk slugs, slug uniqueness.",
    results,
    ...tally(results),
  };
}

/** Check C: cross-link resolution (parent_product_line, base_server, runs_on_nodes, etc). */
export function auditCrossLinks(walk: PortfolioWalk): SubAuditReport {
  const results: CheckResult[] = [];

  // Build a quick lookup of every product MD path.
  const productMdPaths = new Set<string>(
    walk.products.filter((p) => p.exists).map((p) => p.mdPath)
  );
  const productLineMdPaths = new Set<string>(
    walk.productLines.filter((l) => l.exists).map((l) => l.mdPath)
  );

  function resolveRelativeLink(fromMd: string, target: string): string | null {
    if (!target || typeof target !== "string") return null;
    const fromDir = path.dirname(fromMd);
    const abs = path.resolve(fromDir, target);
    if (!isPathInsideRoot(DATA_DIR, abs)) return null;
    if (!fs.existsSync(abs)) return null;
    return abs;
  }

  // Cross-extraction-json look-aside helpers (HCI base_server slug + chassis-membership slug)
  function findProductMdBySlug(category: string, productLine: string, slug: string): string | null {
    // Search across vendors for {category}/{*}/{productLine}/{slug}/{slug}.md
    // (we don't pre-index by slug because slugs are scoped per product line).
    for (const p of walk.products) {
      if (
        p.category === category &&
        p.productLine === productLine &&
        p.slug === slug &&
        p.exists
      ) {
        return p.mdPath;
      }
    }
    return null;
  }

  for (const p of walk.products) {
    if (!p.exists) continue;
    const subject = relFromData(p.mdPath);
    let anyChecked = false;
    let anyFailed = false;

    const fm = p.frontmatter;

    // parent_product_line — relative path from product MD's dir.
    if (typeof fm.parent_product_line === "string") {
      anyChecked = true;
      const resolved = resolveRelativeLink(p.mdPath, fm.parent_product_line);
      if (!resolved || !productLineMdPaths.has(resolved)) {
        results.push({
          status: "fail",
          subject,
          message: `\`parent_product_line: ${fm.parent_product_line}\` does not resolve to an existing product line MD.`,
          fixHint: `Verify the relative path; expected \`../${p.productLine}.md\`.`,
        });
        anyFailed = true;
      }
    } else if (p.exists) {
      // Required for product MDs per _base.md.
      results.push({
        status: "fail",
        subject,
        message: `Product MD missing required \`parent_product_line:\` frontmatter.`,
        fixHint: `Add \`parent_product_line: ../${p.productLine}.md\`.`,
      });
      anyFailed = true;
    }

    // base_server — HCI hardware-node cross-link. Schema convention: stored as a
    // SLUG referencing server/{vendor}/poweredge/{slug}/. Some legacy MDs may
    // store it as a relative path; we try both.
    if (fm.base_server) {
      anyChecked = true;
      const v = String(fm.base_server);
      let resolvedOk = false;
      // Try as slug (common case for HCI):
      const slugCandidate = findProductMdBySlug("server", "poweredge", v);
      if (slugCandidate) resolvedOk = true;
      // Fall back: relative path style
      if (!resolvedOk) {
        const abs = resolveRelativeLink(p.mdPath, v);
        if (abs && productMdPaths.has(abs)) resolvedOk = true;
      }
      if (!resolvedOk) {
        results.push({
          status: "fail",
          subject,
          message: `\`base_server: ${v}\` does not resolve. Expected slug of an existing PowerEdge product MD or relative path.`,
          fixHint: `Confirm the referenced server is in \`server/dell/poweredge/{slug}/\`.`,
        });
        anyFailed = true;
      }
    }

    // runs_on_nodes — list of relative paths to product MDs.
    if (Array.isArray(fm.runs_on_nodes)) {
      anyChecked = true;
      for (const target of fm.runs_on_nodes) {
        const tStr = String(target);
        const abs = resolveRelativeLink(p.mdPath, tStr);
        if (!abs || !productMdPaths.has(abs)) {
          results.push({
            status: "fail",
            subject,
            message: `\`runs_on_nodes\` entry \`${tStr}\` does not resolve to an existing product MD.`,
            fixHint: `Verify the relative path against on-disk hardware-node product MDs.`,
          });
          anyFailed = true;
        }
      }
    }

    // predecessor / successor — slug within same product line.
    for (const key of ["predecessor", "successor"] as const) {
      if (typeof fm[key] === "string") {
        anyChecked = true;
        const slug = fm[key];
        const candidate = findProductMdBySlug(p.category, p.productLine, slug);
        if (!candidate) {
          results.push({
            status: "warn",
            subject,
            message: `\`${key}: ${slug}\` does not resolve to a sibling product in \`${p.productLine}\`. May be intentional (cross-line successor) — verify manually.`,
            fixHint: `If the sibling is in another product line, document the relationship in notes; the schema currently scopes to same-line.`,
          });
        }
      }
    }

    // bundled_target_storage — DPS integrated-appliance overlay; references a
    // backup-target product slug. We resolve to {storage}/dell/powerprotect-data-domain/{slug}/.
    if (typeof fm.bundled_target_storage === "string") {
      anyChecked = true;
      const slug = fm.bundled_target_storage;
      const candidate = findProductMdBySlug(
        "storage",
        "powerprotect-data-domain",
        slug
      );
      if (!candidate) {
        results.push({
          status: "fail",
          subject,
          message: `\`bundled_target_storage: ${slug}\` does not resolve to a PowerProtect Data Domain product MD.`,
          fixHint: `Verify the slug exists under \`storage/dell/powerprotect-data-domain/\`.`,
        });
        anyFailed = true;
      }
    }

    // installs_in_chassis_slug — chassis-resident overlays (multi-node, modular-sled,
    // chassis-fabric). Frontmatter form is uncommon (typically lives in extraction.json),
    // but schema permits it. Resolve to chassis/{vendor}/{?}/{slug}/.
    if (typeof fm.installs_in_chassis_slug === "string") {
      anyChecked = true;
      const slug = fm.installs_in_chassis_slug;
      // Search across chassis product lines.
      let resolved = false;
      for (const cand of walk.products) {
        if (cand.category === "chassis" && cand.slug === slug && cand.exists) {
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        results.push({
          status: "warn",
          subject,
          message: `\`installs_in_chassis_slug: ${slug}\` does not resolve to a chassis product MD on disk.`,
          fixHint: `Confirm the chassis is extracted under \`chassis/{vendor}/{line}/${slug}/\`.`,
        });
      }
    }

    if (anyChecked && !anyFailed) {
      results.push({
        status: "pass",
        subject,
        message: `All cross-links resolve.`,
      });
    }
  }

  return {
    checkName: "cross-links",
    description:
      "Cross-link resolution: parent_product_line, base_server, runs_on_nodes, predecessor/successor, bundled_target_storage, installs_in_chassis_slug.",
    results,
    ...tally(results),
  };
}

/** Check K + product MD orphans. */
export function auditOrphans(walk: PortfolioWalk): SubAuditReport {
  const results: CheckResult[] = [];

  // Orphan product directories (no {slug}.md).
  for (const p of walk.products) {
    if (!p.exists) {
      results.push({
        status: "fail",
        subject: relFromData(p.productDir),
        message: `Product directory exists with no \`${p.slug}.md\` MD file.`,
        fixHint: `Either populate the product MD or remove the directory.`,
      });
    }
  }

  // Build a set of every PDF/MD-sidecar physically referenced by a manifest.
  const referencedAbs = new Set<string>();
  for (const md of [...walk.productLines, ...walk.products]) {
    if (!md.exists) continue;
    const sources = Array.isArray((md.frontmatter as any).sources)
      ? (md.frontmatter as any).sources
      : [];
    for (const row of sources) {
      const fromDir = path.dirname(md.mdPath);
      for (const k of ["local", "local_extraction"]) {
        const v = row?.[k];
        if (typeof v !== "string" || !v) continue;
        const abs = path.resolve(fromDir, v);
        if (isPathInsideRoot(DATA_DIR, abs)) referencedAbs.add(abs);
      }
    }
  }

  // Walk every source/ dir in scope, flag PDFs + sidecars not in the referenced set.
  for (const sd of walk.sourceDirs) {
    const files = listFilesInDir(sd, [".pdf", ".md"]);
    for (const f of files) {
      const abs = path.join(sd, f);
      if (referencedAbs.has(abs)) continue;
      results.push({
        status: "fail",
        subject: relFromData(abs),
        message: `Source file is not referenced by any manifest.`,
        fixHint: `Either add a \`sources:\` row in the appropriate MD or delete the file.`,
      });
    }
  }

  // Pass marker per source dir if all its files were referenced.
  for (const sd of walk.sourceDirs) {
    const files = listFilesInDir(sd, [".pdf", ".md"]);
    if (files.length === 0) continue;
    const anyOrphan = files.some((f) => !referencedAbs.has(path.join(sd, f)));
    if (!anyOrphan) {
      results.push({
        status: "pass",
        subject: relFromData(sd),
        message: `All ${files.length} file${files.length === 1 ? "" : "s"} in source/ referenced by a manifest.`,
      });
    }
  }

  return {
    checkName: "orphans",
    description:
      "Orphan product directories (no MD) + orphan PDFs / sidecars (not referenced by any manifest).",
    results,
    ...tally(results),
  };
}

/** Check I + J + L: manifest exhaustiveness, path resolution, and cross-scope dedup. */
export function auditManifests(walk: PortfolioWalk): SubAuditReport {
  const results: CheckResult[] = [];

  // I + J across product MDs and product line MDs.
  for (const md of [...walk.productLines, ...walk.products]) {
    if (!md.exists) continue;
    const subject = relFromData(md.mdPath);
    const sources = (md.frontmatter as any).sources;

    if (!Array.isArray(sources) || sources.length === 0) {
      results.push({
        status: "fail",
        subject,
        message: `Frontmatter \`sources:\` is missing or empty. Manifest is the canonical index — must list ≥1 source.`,
        fixHint: `Populate the \`sources:\` block with at least one source row.`,
      });
      continue;
    }

    const fromDir = path.dirname(md.mdPath);
    let anyFail = false;

    for (let i = 0; i < sources.length; i++) {
      const row = sources[i];
      const rowLabel = `row ${i + 1}`;
      for (const k of ["local", "local_extraction"] as const) {
        const v = row?.[k];
        if (k === "local" && (!v || typeof v !== "string")) {
          results.push({
            status: "fail",
            subject,
            message: `Source ${rowLabel} missing required \`local:\` field.`,
            fixHint: `Add \`local: source/<file>.pdf\` (or up-scope path) to the row.`,
          });
          anyFail = true;
          continue;
        }
        if (k === "local_extraction" && !v) {
          results.push({
            status: "warn",
            subject,
            message: `Source ${rowLabel} has no \`local_extraction:\` (sidecar). Required for extraction-time evidence; PDF-only rows skip extraction.`,
            fixHint: `Run pull-sources / parse to generate the .md sidecar.`,
          });
          continue;
        }
        if (typeof v !== "string") continue;
        const abs = path.resolve(fromDir, v);
        if (!isPathInsideRoot(DATA_DIR, abs) || !fs.existsSync(abs)) {
          results.push({
            status: "fail",
            subject,
            message: `Source ${rowLabel} \`${k}: ${v}\` does not resolve to an existing file.`,
            fixHint: `Fix the relative path or pull/generate the missing file.`,
          });
          anyFail = true;
        }
      }
    }

    if (!anyFail) {
      results.push({
        status: "pass",
        subject,
        message: `Manifest has ${sources.length} row${sources.length === 1 ? "" : "s"}; all paths resolve.`,
      });
    }
  }

  // L: cross-scope SHA-256 duplicates within a product line.
  // Group source dirs by their owning product line.
  type ScopedFile = { abs: string; scope: "category" | "line" | "product" };
  const linesIndex = new Map<string, ScopedFile[]>();

  for (const line of walk.productLines) {
    const key = `${line.category}/${line.vendor}/${line.productLine}`;
    if (!linesIndex.has(key)) linesIndex.set(key, []);
    const lineSourceDir = path.join(line.lineDir, "source");
    if (fs.existsSync(lineSourceDir)) {
      for (const f of listFilesInDir(lineSourceDir, [".pdf"])) {
        linesIndex.get(key)!.push({ abs: path.join(lineSourceDir, f), scope: "line" });
      }
    }
  }
  for (const p of walk.products) {
    const key = `${p.category}/${p.vendor}/${p.productLine}`;
    if (!linesIndex.has(key)) linesIndex.set(key, []);
    const prodSourceDir = path.join(p.productDir, "source");
    if (fs.existsSync(prodSourceDir)) {
      for (const f of listFilesInDir(prodSourceDir, [".pdf"])) {
        linesIndex.get(key)!.push({
          abs: path.join(prodSourceDir, f),
          scope: "product",
        });
      }
    }
  }

  function sha256OfFile(abs: string): string | null {
    try {
      const buf = fs.readFileSync(abs);
      return crypto.createHash("sha256").update(buf).digest("hex");
    } catch {
      return null;
    }
  }

  for (const [key, files] of linesIndex) {
    if (files.length < 2) continue;
    const byHash = new Map<string, ScopedFile[]>();
    for (const f of files) {
      const h = sha256OfFile(f.abs);
      if (!h) continue;
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h)!.push(f);
    }
    for (const [, group] of byHash) {
      if (group.length < 2) continue;
      const paths = group.map((g) => relFromData(g.abs)).join(" AND ");
      results.push({
        status: "fail",
        subject: key,
        message: `Cross-scope PDF duplicate within product line: same SHA-256 at ${paths}.`,
        fixHint: `Delete the lower-scope copy and update its MD's \`sources:\` row to reference the higher-scope path via \`../source/<file>\`.`,
      });
    }
  }

  return {
    checkName: "manifests",
    description:
      "Manifest exhaustiveness, every `local:` / `local_extraction:` resolves, no cross-scope SHA-256 duplicates within a product line.",
    results,
    ...tally(results),
  };
}

// ----------------------------------------------------------------------------
// Top-level orchestrator
// ----------------------------------------------------------------------------

export async function auditPortfolio(scope?: {
  category?: string;
}): Promise<AuditReport> {
  const start = Date.now();
  const walk = walkPortfolio(scope);

  // Run all sub-audits. They're synchronous (pure file IO + parsing) but the
  // function is async to match the contract — future callers may parallelize.
  const subAudits: SubAuditReport[] = [
    auditProductLineConsistency(walk),
    auditCrossLinks(walk),
    auditOrphans(walk),
    auditManifests(walk),
  ];

  // Per-category totals — tag each result by which category its subject belongs to.
  const byCategory: Record<string, { pass: number; fail: number; warn: number }> = {};
  const categories = Array.from(new Set(walk.products.map((p) => p.category))).sort();
  for (const c of categories) byCategory[c] = { pass: 0, fail: 0, warn: 0 };

  function categorizeSubject(subject: string): string | null {
    const first = subject.split("/")[0];
    return KNOWN_CATEGORIES.has(first) ? first : null;
  }

  let totalPass = 0,
    totalFail = 0,
    totalWarn = 0;
  for (const sa of subAudits) {
    for (const r of sa.results) {
      if (r.status === "pass") totalPass++;
      else if (r.status === "fail") totalFail++;
      else totalWarn++;
      const cat = categorizeSubject(r.subject);
      if (cat && byCategory[cat]) {
        byCategory[cat][r.status]++;
      }
    }
  }

  return {
    scope: scope ?? {},
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    categories,
    totals: { pass: totalPass, fail: totalFail, warn: totalWarn },
    byCategory,
    subAudits,
  };
}

export type { PortfolioWalk };
