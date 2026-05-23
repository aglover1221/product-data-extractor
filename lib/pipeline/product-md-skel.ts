/**
 * Product MD skeleton writer.
 *
 * After the user approves a discovered_product, we drop a minimal product MD
 * at `{category}/{vendor}/{line}/{slug}/{slug}.md` so downstream phases
 * (sources, parse, extract) have a manifest to read.
 *
 * Pattern matches existing product MDs (e.g. server/dell/poweredge/r770/r770.md):
 *   - frontmatter: vendor / category / kind: product / product_line /
 *     parent_product_line / status / last_updated / sources: []
 *   - body: # Title heading + ## Sources placeholder
 *
 * NO PROSE per project conventions "no prose in portfolio MDs" rule. Everything else is
 * filled by humans / synthesizers.
 *
 * Atomic write: tmp file + rename.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export interface ProductMdSkelInput {
  category: string;
  vendor: string; // lowercase ("dell")
  line: string; // product line slug
  slug: string;
  model: string; // canonical model name (e.g. "PowerEdge R770")
  description?: string;
}

export interface ProductMdSkelResult {
  absPath: string;
  relPath: string;
  created: boolean; // true if newly created, false if already existed
}

const VENDOR_DISPLAY: Record<string, string> = {
  dell: "Dell Technologies",
  hpe: "HPE",
  lenovo: "Lenovo",
};

const SAFE_PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

function vendorDisplayName(vendor: string): string {
  return VENDOR_DISPLAY[vendor.toLowerCase()] ?? vendor;
}

export function assertSafePathSegment(label: string, value: string): void {
  if (!SAFE_PATH_SEGMENT.test(value) || value === "." || value === "..") {
    throw new Error(`${label} must be a safe path segment`);
  }
}

export function assertInsideDataRoot(absPath: string): void {
  const root = path.resolve(env.PRODUCT_MCP_DATA_DIR);
  const target = path.resolve(absPath);
  const rel = path.relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new Error("path escapes PRODUCT_MCP_DATA_DIR");
}

export function resolveDataRootPath(relPath: string): string {
  if (!relPath || path.isAbsolute(relPath)) {
    throw new Error("path must be relative to PRODUCT_MCP_DATA_DIR");
  }
  const abs = path.resolve(env.PRODUCT_MCP_DATA_DIR, relPath);
  assertInsideDataRoot(abs);
  return abs;
}

export function productDirAbs({
  category,
  vendor,
  line,
  slug,
}: Pick<ProductMdSkelInput, "category" | "vendor" | "line" | "slug">): string {
  assertSafePathSegment("category", category);
  assertSafePathSegment("vendor", vendor);
  assertSafePathSegment("line", line);
  assertSafePathSegment("slug", slug);

  const dir = path.resolve(
    env.PRODUCT_MCP_DATA_DIR,
    category,
    vendor.toLowerCase(),
    line,
    slug
  );
  assertInsideDataRoot(dir);
  return dir;
}

export function productMdAbs(input: Pick<ProductMdSkelInput, "category" | "vendor" | "line" | "slug">): string {
  const mdAbs = path.resolve(productDirAbs(input), `${input.slug}.md`);
  assertInsideDataRoot(mdAbs);
  return mdAbs;
}

export function writeProductMdSkeleton(
  input: ProductMdSkelInput
): ProductMdSkelResult {
  // Refuse writing into legacy /dell/ tree for non-Dell vendors per
  // pull-sources skill: "Refuse to run if computed path includes `dell/` for
  // a non-Dell vendor." Catches accidental misconfigured discoveries before
  // they pollute the legacy tree.
  const vendorLower = input.vendor.toLowerCase();
  if (vendorLower !== "dell") {
    const segs = [input.category, vendorLower, input.line, input.slug];
    if (segs.includes("dell")) {
      throw new Error(
        `writeProductMdSkeleton: refuse to write non-Dell product (vendor=${vendorLower}) into a path that contains "dell/" segment`
      );
    }
  }

  const dir = productDirAbs(input);
  const mdAbs = productMdAbs(input);
  const dataDir = path.resolve(env.PRODUCT_MCP_DATA_DIR);
  const relPath = path.relative(dataDir, mdAbs);

  if (fs.existsSync(mdAbs)) {
    return { absPath: mdAbs, relPath, created: false };
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "source"), { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const description = input.description?.trim()
    ? `\ndescription: ${jsonString(input.description.trim())}`
    : "";

  const md = `---
vendor: ${vendorDisplayName(input.vendor)}
category: ${input.category}
kind: product
product_line: ${input.line}
parent_product_line: ../${input.line}.md${description}
status: current
last_updated: ${today}
sources: []
---

# ${input.model}

## Sources

<!-- Sources will be populated by the source-acquisition phase. -->
`;

  // Atomic write
  const tmp = `${mdAbs}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, md, "utf8");
  fs.renameSync(tmp, mdAbs);

  return { absPath: mdAbs, relPath, created: true };
}

function jsonString(s: string): string {
  return JSON.stringify(s);
}
