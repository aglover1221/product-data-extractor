import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./repo-walk";
import { parseMarkdown } from "./safe-matter";
import { readProductMdManifest } from "./sources";

/**
 * Categories that look like portfolio roots — top-level subdirectories of
 * DATA_ROOT that aren't dotfiles, underscore-prefixed (`_planning`,
 * `_discovery`), or reserved (`schemas`, `node_modules`, etc.).
 */
const RESERVED_TOP_LEVEL = new Set([
  "schemas",
  "node_modules",
  ".next",
  "data",
  "lib",
  "app",
  "scripts",
  "public",
  "web"
]);

export type Category = string;

export type ProductEntry = {
  category: Category;
  vendor: string;
  product_line: string;
  product_line_name: string;
  slug: string;
  model: string | null;
  product_dir: string;
  pdf_count: number;
  md_count: number;
  has_extraction: boolean;
};

export type LineSource = {
  /** Filename inside `{line}/source/` (e.g. "tech-guide.pdf"). */
  name: string;
  /** Sibling parsed sidecar filename if present (e.g. "tech-guide.md"). */
  parsed_name: string | null;
  size: number;
};

export type ProductLineGroup = {
  vendor: string;
  product_line: string;
  product_line_name: string;
  has_md: boolean;
  /** Files in `{category}/{vendor}/{line}/source/` — line-scope docs shared across the line. */
  line_sources: LineSource[];
  /** Slug of the first product in the line; used as anchor for line-scope source links. */
  link_anchor_slug: string | null;
  products: ProductEntry[];
};

export type CategoryGroup = {
  category: Category;
  product_count: number;
  product_lines: ProductLineGroup[];
};

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isHidden(name: string): boolean {
  return name.startsWith(".") || name.startsWith("_");
}

function readProductLineMd(dir: string, productLine: string): { name: string } | null {
  const fp = path.join(dir, `${productLine}.md`);
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const { data } = parseMarkdown(raw);
    return { name: data.product_line_name ?? data.name ?? productLine };
  } catch {
    return null;
  }
}

function readExtractionModel(productDir: string): string | null {
  const fp = path.join(productDir, "extraction.json");
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const d = JSON.parse(raw);
    return typeof d.model === "string" ? d.model : null;
  } catch {
    return null;
  }
}

function countOwnSourceFiles(dir: string): { pdf: number; md: number } {
  const sourceDir = path.join(dir, "source");
  let pdf = 0;
  let md = 0;
  if (!fs.existsSync(sourceDir)) return { pdf, md };
  for (const e of safeReaddir(sourceDir)) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (lower.endsWith(".pdf")) pdf++;
    else if (lower.endsWith(".md")) md++;
  }
  return { pdf, md };
}

function classifyProductDir(
  category: Category,
  vendor: string,
  productLine: string,
  slug: string,
  dir: string
): ProductEntry {
  const manifest = readProductMdManifest(dir, slug);
  let pdfCount = 0;
  let mdCount = 0;
  if (manifest && manifest.length > 0) {
    for (const m of manifest) {
      if (m.local.toLowerCase().endsWith(".pdf") && m.resolved_path) pdfCount++;
      if (m.local_extraction && m.local_extraction.toLowerCase().endsWith(".md") && m.resolved_extraction_path) mdCount++;
    }
  } else {
    const own = countOwnSourceFiles(dir);
    pdfCount = own.pdf;
    mdCount = own.md;
  }
  const hasExtraction = fs.existsSync(path.join(dir, "extraction.json"));
  const model = readExtractionModel(dir);
  return {
    category,
    vendor,
    product_line: productLine,
    product_line_name: productLine,
    slug,
    model,
    product_dir: dir,
    pdf_count: pdfCount,
    md_count: mdCount,
    has_extraction: hasExtraction
  };
}

function readLineSources(lineDir: string): LineSource[] {
  const sourceDir = path.join(lineDir, "source");
  if (!fs.existsSync(sourceDir)) return [];
  const files = safeReaddir(sourceDir).filter((e) => e.isFile());
  const mdNames = new Set(files.map((f) => f.name).filter((n) => n.toLowerCase().endsWith(".md")));
  const out: LineSource[] = [];
  for (const e of files) {
    if (!e.name.toLowerCase().endsWith(".pdf")) continue;
    const parsedName = e.name.replace(/\.pdf$/i, ".md");
    let size = 0;
    try {
      size = fs.statSync(path.join(sourceDir, e.name)).size;
    } catch {
      // skip
    }
    out.push({
      name: e.name,
      parsed_name: mdNames.has(parsedName) ? parsedName : null,
      size
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Top-level dirs under DATA_ROOT that look like product categories. */
function listCategories(): Category[] {
  const out: Category[] = [];
  for (const e of safeReaddir(DATA_ROOT)) {
    if (!e.isDirectory()) continue;
    if (isHidden(e.name) || RESERVED_TOP_LEVEL.has(e.name)) continue;
    // A category dir must contain at least one vendor dir.
    const vendors = safeReaddir(path.join(DATA_ROOT, e.name)).filter(
      (v) => v.isDirectory() && !isHidden(v.name)
    );
    if (vendors.length > 0) out.push(e.name);
  }
  return out.sort();
}

export function listPortfolio(): CategoryGroup[] {
  const out: CategoryGroup[] = [];
  for (const category of listCategories()) {
    const catRoot = path.join(DATA_ROOT, category);
    const lineGroups: ProductLineGroup[] = [];
    for (const vendorEntry of safeReaddir(catRoot)) {
      if (!vendorEntry.isDirectory() || isHidden(vendorEntry.name)) continue;
      const vendor = vendorEntry.name;
      const vendorDir = path.join(catRoot, vendor);
      for (const lineEntry of safeReaddir(vendorDir)) {
        if (!lineEntry.isDirectory() || isHidden(lineEntry.name)) continue;
        const lineDir = path.join(vendorDir, lineEntry.name);
        const lineMd = readProductLineMd(lineDir, lineEntry.name);
        const products: ProductEntry[] = [];
        for (const prodEntry of safeReaddir(lineDir)) {
          if (!prodEntry.isDirectory() || isHidden(prodEntry.name)) continue;
          if (prodEntry.name === "source") continue;
          const productDir = path.join(lineDir, prodEntry.name);
          const hasMd = fs.existsSync(path.join(productDir, `${prodEntry.name}.md`));
          const hasExtraction = fs.existsSync(path.join(productDir, "extraction.json"));
          const hasOwnSourceDir = fs.existsSync(path.join(productDir, "source"));
          if (!hasMd && !hasExtraction && !hasOwnSourceDir) continue;
          const entry = classifyProductDir(category, vendor, lineEntry.name, prodEntry.name, productDir);
          if (lineMd) entry.product_line_name = lineMd.name;
          products.push(entry);
        }
        products.sort((a, b) => a.slug.localeCompare(b.slug));
        const lineSources = readLineSources(lineDir);
        if (products.length === 0 && !lineMd && lineSources.length === 0) continue;
        lineGroups.push({
          vendor,
          product_line: lineEntry.name,
          product_line_name: lineMd?.name ?? lineEntry.name,
          has_md: lineMd !== null,
          line_sources: lineSources,
          link_anchor_slug: products[0]?.slug ?? null,
          products
        });
      }
    }
    lineGroups.sort((a, b) =>
      (a.vendor + a.product_line_name).localeCompare(b.vendor + b.product_line_name)
    );
    const productCount = lineGroups.reduce((acc, g) => acc + g.products.length, 0);
    if (productCount === 0) continue;
    out.push({ category, product_count: productCount, product_lines: lineGroups });
  }
  return out;
}

/** Locate a single product by slug across all categories and vendors. */
export function findProduct(slug: string): ProductEntry | null {
  for (const category of listCategories()) {
    const catRoot = path.join(DATA_ROOT, category);
    for (const vendorEntry of safeReaddir(catRoot)) {
      if (!vendorEntry.isDirectory() || isHidden(vendorEntry.name)) continue;
      const vendor = vendorEntry.name;
      const vendorDir = path.join(catRoot, vendor);
      for (const lineEntry of safeReaddir(vendorDir)) {
        if (!lineEntry.isDirectory() || isHidden(lineEntry.name)) continue;
        const lineDir = path.join(vendorDir, lineEntry.name);
        const productDir = path.join(lineDir, slug);
        if (!fs.existsSync(productDir)) continue;
        const lineMd = readProductLineMd(lineDir, lineEntry.name);
        const entry = classifyProductDir(category, vendor, lineEntry.name, slug, productDir);
        if (lineMd) entry.product_line_name = lineMd.name;
        return entry;
      }
    }
  }
  return null;
}
