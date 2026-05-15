/**
 * Walks PRODUCT_MCP_DATA_DIR/{category}/dell/{line}/{slug}/{slug}.md to
 * enumerate every Dell product on disk for the extraction picker.
 *
 * Returns one row per product directory, with category/line/slug metadata
 * and a `hasExtraction` flag (presence of extraction.json).
 *
 * Used by the extraction submit form (`/pipeline/extract`) and the run-detail
 * "re-extract" UI; both need the same canonical product list.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export interface ProductOnDisk {
  /** Top-level category dir: server | storage | hci | networking | chassis | software-defined-infrastructure */
  category: string;
  /** Vendor — locked to dell for the MVP. */
  vendor: string;
  /** Product line dir (e.g. poweredge, powermax, vxrail). */
  line: string;
  /** Product slug (last path segment). */
  slug: string;
  /** Path relative to PRODUCT_MCP_DATA_DIR — what extract loadProductContext expects. */
  productPathRel: string;
  /** True if extraction.json already exists on disk (for filter / sort UX). */
  hasExtraction: boolean;
}

const KNOWN_CATEGORIES = [
  "server",
  "storage",
  "hci",
  "networking",
  "chassis",
  "software-defined-infrastructure",
];

function readdirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

/**
 * Enumerate every product on disk. Cheap enough to call per-request; the tree
 * has ~240 dirs total and we only stat for extraction.json + the slug MD.
 */
export function listProductsOnDisk(): ProductOnDisk[] {
  const root = env.PRODUCT_MCP_DATA_DIR;
  const out: ProductOnDisk[] = [];
  for (const category of KNOWN_CATEGORIES) {
    const categoryDir = path.join(root, category);
    if (!fs.existsSync(categoryDir)) continue;
    // Vendor layer is dell-only for MVP; tolerate other vendors if they appear.
    for (const vendor of readdirSafe(categoryDir)) {
      const vendorDir = path.join(categoryDir, vendor);
      for (const line of readdirSafe(vendorDir)) {
        const lineDir = path.join(vendorDir, line);
        for (const slug of readdirSafe(lineDir)) {
          const productDir = path.join(lineDir, slug);
          // Heuristic: a real product dir has {slug}.md.
          const slugMd = path.join(productDir, `${slug}.md`);
          if (!fs.existsSync(slugMd)) continue;
          const hasExtraction = fs.existsSync(
            path.join(productDir, "extraction.json")
          );
          out.push({
            category,
            vendor,
            line,
            slug,
            productPathRel: path.relative(root, productDir),
            hasExtraction,
          });
        }
      }
    }
  }
  out.sort((a, b) =>
    `${a.category}/${a.line}/${a.slug}`.localeCompare(
      `${b.category}/${b.line}/${b.slug}`
    )
  );
  return out;
}

/** Group products by category for the picker UI. */
export function listProductsByCategory(): Record<string, ProductOnDisk[]> {
  const grouped: Record<string, ProductOnDisk[]> = {};
  for (const p of listProductsOnDisk()) {
    (grouped[p.category] ??= []).push(p);
  }
  return grouped;
}

/** Resolve a product slug back to its on-disk row (for re-extract from product page). */
export function findProductBySlug(slug: string): ProductOnDisk | null {
  return listProductsOnDisk().find(p => p.slug === slug) ?? null;
}
