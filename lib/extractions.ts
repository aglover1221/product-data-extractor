import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./repo-walk";

export type Evidence = {
  source: string;
  anchor?: string;
  page?: number;
  quote?: string;
  confidence?: number;
  derivation?: string;
  derived?: boolean;
  status?: string;
};

export type ScalarField = {
  value: any;
  evidence: Evidence | null;
};

export type Extraction = {
  vendor: string;
  category: string;
  subcategory?: string;
  product_line: string;
  slug: string;
  model: string;
  extraction_metadata?: any;
  sources?: any[];
  [key: string]: any;
};

export type ServerSummary = {
  kind: "server";
  slug: string;
  model: string;
  vendor: string;
  category: string;
  product_line: string;
  server_type: string | null;
  generation: string | null;
  socket_count: number | null;
  processor_family: string[];
  rack_units: number | null;
  max_memory_gb: number | null;
  max_drive_count: number | null;
  supports_gpu: boolean | null;
  supports_dlc: boolean | null;
  cpu_skus_count: number;
  pcie_slots_count: number;
  riser_configs_count: number;
  schema_version: string | null;
  extracted_at: string | null;
  source_path: string;
};

export type StorageSummary = {
  kind: "storage";
  slug: string;
  model: string;
  vendor: string;
  category: string;
  subcategory: string | null;
  product_line: string;
  position_in_line: string | null;
  topology: string | null;
  scale_model: string | null;
  drive_ownership: string | null;
  max_heads_per_cluster: number | null;
  max_effective_capacity_pbe_per_cluster: number | null;
  max_drives_per_cluster: number | null;
  unified_capabilities: string[];
  has_mainframe: boolean;
  has_file: boolean;
  block_protocols: string[];
  replication_count: number;
  schema_version: string | null;
  extracted_at: string | null;
  concrete_pct: number | null;
  source_path: string;
};

export type ExtractionSummary = ServerSummary | StorageSummary;

function unwrap<T = any>(field: any): T | null {
  if (field == null) return null;
  if (typeof field === "object" && "value" in field) return field.value as T;
  return field as T;
}

function walk(dir: string, out: string[], depth = 0) {
  if (depth > 8) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "source") {
      continue;
    }
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fp, out, depth + 1);
    } else if (entry.name === "extraction.json") {
      out.push(fp);
    }
  }
}

function summarizeServer(d: Extraction, fp: string): ServerSummary {
  return {
    kind: "server",
    slug: unwrap<string>(d.slug) ?? "",
    model: unwrap<string>(d.model) ?? "",
    vendor: unwrap<string>(d.vendor) ?? "",
    category: unwrap<string>(d.category) ?? "",
    product_line: unwrap<string>(d.product_line) ?? "",
    server_type: unwrap<string>(d.server_type),
    generation: unwrap<string>(d.generation),
    socket_count: unwrap<number>(d.socket_count),
    processor_family: unwrap<string[]>(d.processor_family) ?? [],
    rack_units: unwrap<number>(d.rack_units),
    max_memory_gb: unwrap<number>(d.max_memory_gb),
    max_drive_count: unwrap<number>(d.max_drive_count),
    supports_gpu: unwrap<boolean>(d.supports_gpu),
    supports_dlc: unwrap<boolean>(d.supports_dlc),
    cpu_skus_count: Array.isArray(d.cpu_skus) ? d.cpu_skus.length : 0,
    pcie_slots_count: Array.isArray(d.pcie_slots) ? d.pcie_slots.length : 0,
    riser_configs_count: Array.isArray(d.riser_configs) ? d.riser_configs.length : 0,
    schema_version: d.extraction_metadata?.schema_version ?? null,
    extracted_at: d.extraction_metadata?.extracted_at ?? null,
    source_path: fp
  };
}

function summarizeStorage(d: Extraction, fp: string): StorageSummary {
  const unified = unwrap<string[]>(d.unified_capabilities) ?? [];
  return {
    kind: "storage",
    slug: unwrap<string>(d.slug) ?? "",
    model: unwrap<string>(d.model) ?? "",
    vendor: unwrap<string>(d.vendor) ?? "",
    category: unwrap<string>(d.category) ?? "",
    subcategory: unwrap<string>(d.subcategory) ?? null,
    product_line: unwrap<string>(d.product_line) ?? "",
    position_in_line: unwrap<string>(d.position_in_line),
    topology: unwrap<string>(d.controller_topology),
    scale_model: unwrap<string>(d.scale_model),
    drive_ownership: unwrap<string>(d.drive_ownership_model),
    max_heads_per_cluster: unwrap<number>(d.max_heads_per_cluster),
    max_effective_capacity_pbe_per_cluster: unwrap<number>(d.max_effective_capacity_pbe_per_cluster),
    max_drives_per_cluster: unwrap<number>(d.max_drives_per_cluster),
    unified_capabilities: unified,
    has_mainframe: unified.includes("mainframe"),
    has_file: unified.includes("file"),
    block_protocols: unwrap<string[]>(d.block_protocols) ?? [],
    replication_count: Array.isArray(d.replication_capabilities) ? d.replication_capabilities.length : 0,
    schema_version: d.extraction_metadata?.schema_version ?? null,
    extracted_at: d.extraction_metadata?.extracted_at ?? null,
    concrete_pct: d.extraction_metadata?.coverage_meta?.concrete_pct ?? null,
    source_path: fp
  };
}

export function listExtractions(): ExtractionSummary[] {
  const files: string[] = [];
  walk(DATA_ROOT, files);
  return files
    .map((fp) => {
      try {
        const raw = fs.readFileSync(fp, "utf8");
        const d: Extraction = JSON.parse(raw);
        if (d.category === "storage") return summarizeStorage(d, fp);
        return summarizeServer(d, fp);
      } catch (err) {
        console.error(`Failed to load ${fp}:`, err);
        return null;
      }
    })
    .filter((x): x is ExtractionSummary => x !== null)
    .sort((a, b) => a.model.localeCompare(b.model));
}

export function getExtraction(slug: string): Extraction | null {
  const files: string[] = [];
  walk(DATA_ROOT, files);
  for (const fp of files) {
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const d: Extraction = JSON.parse(raw);
      if (d.slug === slug) return d;
    } catch {
      // skip
    }
  }
  return null;
}

/** Returns the product directory itself (parent of source/), e.g. .../server/dell/poweredge/r770. */
export function getProductDir(slug: string): string | null {
  const files: string[] = [];
  walk(DATA_ROOT, files);
  for (const fp of files) {
    try {
      const raw = fs.readFileSync(fp, "utf8");
      const d: Extraction = JSON.parse(raw);
      if (d.slug === slug) return path.dirname(fp);
    } catch {
      // skip
    }
  }
  // Fallback: products without extraction.json yet — locate by slug under any top-level category root.
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(DATA_ROOT, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("_")) continue;
    const found = findProductDirByName(path.join(DATA_ROOT, e.name), slug, 0);
    if (found) return found;
  }
  return null;
}

export function getProductSourceDir(slug: string): string | null {
  const productDir = getProductDir(slug);
  if (!productDir) return null;
  const dir = path.join(productDir, "source");
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Resolve a manifest `local:` (or `local_extraction:`) path to an absolute file on disk,
 * given the product slug. Manifest paths are MD-relative — own-scope = `source/<file>`,
 * line-scope = `../source/<file>`, category-scope = `../../source/<file>`. As a backward-
 * compat affordance for pre-2026-05-07 evidence records that stored bare filenames, a
 * filename without a `source/` prefix is also tried as `<productDir>/source/<file>`.
 * Returns null if the resolved path doesn't exist or escapes DATA_ROOT.
 */
export function resolveProductSourcePath(slug: string, manifestPath: string): string | null {
  if (!manifestPath || manifestPath === "source-silent" || manifestPath === "derived") return null;
  const productDir = getProductDir(slug);
  if (!productDir) return null;

  const candidates: string[] = [];
  const direct = path.resolve(productDir, manifestPath);
  candidates.push(direct);
  // Backward-compat: bare filename → look inside the product's own source/.
  if (!manifestPath.includes("/")) {
    candidates.push(path.resolve(productDir, "source", manifestPath));
  }

  for (const fp of candidates) {
    if (!fp.startsWith(DATA_ROOT)) continue;
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp;
  }
  return null;
}

function findProductDirByName(dir: string, slug: string, depth: number): string | null {
  if (depth > 6) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "source") continue;
    if (e.name === slug) {
      const productDir = path.join(dir, e.name);
      // A product dir has either a `{slug}.md` manifest, an extraction.json, a sources.yaml, or a source/ subdir.
      // Up-scope-only products (sources live entirely at line/category scope) have just the MD.
      if (
        fs.existsSync(path.join(productDir, `${slug}.md`)) ||
        fs.existsSync(path.join(productDir, "source")) ||
        fs.existsSync(path.join(productDir, "sources.yaml")) ||
        fs.existsSync(path.join(productDir, "extraction.json"))
      ) {
        return productDir;
      }
    }
    const nested = findProductDirByName(path.join(dir, e.name), slug, depth + 1);
    if (nested) return nested;
  }
  return null;
}

export { unwrap, DATA_ROOT };
