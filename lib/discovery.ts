import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { parseMarkdown } from "./safe-matter";
import { REPO_ROOT } from "./repo-walk";

export type DiscoveryProduct = {
  canonical_name?: string;
  slug?: string;
  status?: string;
  vendor_tag?: string;
  suggested_output_dir?: string;
  existing?: string | boolean;
  evidence_url?: string;
  workload_tags?: string[];
};

export type DiscoveryProductLine = {
  product_line_name?: string;
  product_line_slug?: string;
  product_line_md_path?: string;
  product_line_md_exists?: string | boolean;
  evidence_url?: string;
  product_line_summary?: any;
  products?: DiscoveryProduct[];
};

export type DiscoveryFrontmatter = {
  kind?: string;
  vendor?: string;
  portfolio_name?: string;
  category?: string;
  run_date?: string;
  source_urls_consulted?: string[];
  vendor_product_line_total?: number;
  enumerated_product_lines?: number;
  total_products_enumerated?: number;
  total_products_in_knowledgebase?: number;
  total_product_gaps?: number;
  total_orphans?: number;
  scope_notes?: string;
};

export type DiscoveryDoc = {
  file: string;
  basename: string;
  fm: DiscoveryFrontmatter;
  product_lines: DiscoveryProductLine[];
  body: string;
};

export type DiscoverySummary = {
  basename: string;
  vendor: string;
  category: string;
  run_date: string;
  product_line_count: number;
  total_products: number;
  fm: DiscoveryFrontmatter;
  file: string;
};

/** Walk REPO_ROOT and return every `{category}/_discovery/*.md` file. */
function listDiscoveryFiles(): string[] {
  const out: string[] = [];
  let topEntries: fs.Dirent[];
  try {
    topEntries = fs.readdirSync(REPO_ROOT, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const top of topEntries) {
    if (!top.isDirectory() || top.name.startsWith(".") || top.name.startsWith("_")) continue;
    const discoveryDir = path.join(REPO_ROOT, top.name, "_discovery");
    if (!fs.existsSync(discoveryDir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(discoveryDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".md")) {
        out.push(path.join(discoveryDir, e.name));
      }
    }
  }
  return out.sort();
}

function coerceDates(v: any): any {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(coerceDates);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = coerceDates(val);
    return out;
  }
  return v;
}

/** Extract first ```yaml ... ``` codeblock. */
function extractYamlCodeblock(body: string, predicate?: (txt: string) => boolean): string | null {
  const re = /```ya?ml\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const txt = m[1];
    if (!predicate || predicate(txt)) return txt;
  }
  return null;
}

export function parseDiscoveryDoc(file: string): DiscoveryDoc | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const parsed = parseMarkdown(raw);
  const fm = parsed.data as DiscoveryFrontmatter;
  const body = parsed.content;

  let product_lines: DiscoveryProductLine[] = [];
  const yamlText = extractYamlCodeblock(body, (txt) => /product_lines:/.test(txt));
  if (yamlText) {
    try {
      const parsedYaml = coerceDates(yaml.load(yamlText)) as any;
      if (Array.isArray(parsedYaml?.product_lines)) {
        product_lines = parsedYaml.product_lines;
      }
    } catch (err) {
      console.error(`Failed to parse YAML in ${file}:`, err);
    }
  }

  return {
    file,
    basename: path.basename(file, ".md"),
    fm,
    product_lines,
    body
  };
}

export function listDiscoveries(): DiscoverySummary[] {
  const files = listDiscoveryFiles();
  const out: DiscoverySummary[] = [];
  for (const fp of files) {
    const doc = parseDiscoveryDoc(fp);
    if (!doc) continue;
    out.push({
      basename: doc.basename,
      vendor: doc.fm.vendor ?? "Unknown",
      category: doc.fm.category ?? "server",
      run_date: doc.fm.run_date ?? "",
      product_line_count: doc.product_lines.length,
      total_products: doc.product_lines.reduce(
        (acc, pl) => acc + (pl.products?.length ?? 0),
        0
      ),
      fm: doc.fm,
      file: fp
    });
  }
  return out.sort((a, b) => a.basename.localeCompare(b.basename));
}

export function getDiscoveryDoc(basename: string): DiscoveryDoc | null {
  const files = listDiscoveryFiles();
  const match = files.find((f) => path.basename(f, ".md") === basename);
  if (!match) return null;
  return parseDiscoveryDoc(match);
}
