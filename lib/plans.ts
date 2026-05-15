import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { parseMarkdown } from "./safe-matter";
import { REPO_ROOT } from "./repo-walk";

export type PlanProduct = {
  vendor?: string;
  product_name?: string;
  canonical_slug?: string;
  product_line_slug?: string;
  server_type?: string;
  output_dir?: string;
  discovery_evidence_url?: string;
  notes?: string;
};

export type PlanDeferred = {
  vendor?: string;
  product_name?: string;
  product_line?: string;
  deferral_reason?: string;
};

export type PlanFrontmatter = {
  plan?: string;
  scope?: string;
  vendors?: string[];
  date?: string;
  in_scope_count?: number;
  deferred_count?: number;
};

export type PlanDoc = {
  file: string;
  basename: string;
  fm: PlanFrontmatter;
  in_scope: PlanProduct[];
  deferred: PlanDeferred[];
  ambiguities_md: string;
  body: string;
};

export type PlanSummary = {
  basename: string;
  date: string;
  in_scope_count: number;
  deferred_count: number;
  fm: PlanFrontmatter;
  file: string;
};

const PLAN_DIR = path.join(REPO_ROOT, "_planning");

function listPlanFiles(prefix: string): string[] {
  if (!fs.existsSync(PLAN_DIR)) return [];
  const entries = fs.readdirSync(PLAN_DIR, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.startsWith(prefix) && e.name.endsWith(".md")) {
      out.push(path.join(PLAN_DIR, e.name));
    }
  }
  return out.sort().reverse();
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

function extractCodeblock(body: string, predicate: (txt: string) => boolean): string | null {
  const re = /```ya?ml\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (predicate(m[1])) return m[1];
  }
  return null;
}

function extractSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (idx < 0) return "";
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

export function parseSourcePullPlan(file: string): PlanDoc | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const parsed = parseMarkdown(raw);
  const fm = parsed.data as PlanFrontmatter;
  const body = parsed.content;

  let in_scope: PlanProduct[] = [];
  let deferred: PlanDeferred[] = [];
  const inScopeYaml = extractCodeblock(body, (t) => /^in_scope:/m.test(t));
  if (inScopeYaml) {
    try {
      const p = coerceDates(yaml.load(inScopeYaml)) as any;
      if (Array.isArray(p?.in_scope)) in_scope = p.in_scope;
    } catch (err) {
      console.error(`Failed in_scope YAML in ${file}:`, err);
    }
  }
  const deferredYaml = extractCodeblock(body, (t) => /^deferred:/m.test(t));
  if (deferredYaml) {
    try {
      const p = coerceDates(yaml.load(deferredYaml)) as any;
      if (Array.isArray(p?.deferred)) deferred = p.deferred;
    } catch (err) {
      console.error(`Failed deferred YAML in ${file}:`, err);
    }
  }

  return {
    file,
    basename: path.basename(file, ".md"),
    fm,
    in_scope,
    deferred,
    ambiguities_md: extractSection(body, "Ambiguities flagged for review"),
    body
  };
}

export function listSourcePullPlans(): PlanSummary[] {
  const files = listPlanFiles("source-pull-plan-");
  const out: PlanSummary[] = [];
  for (const fp of files) {
    const doc = parseSourcePullPlan(fp);
    if (!doc) continue;
    out.push({
      basename: doc.basename,
      date: doc.fm.date ?? "",
      in_scope_count: doc.fm.in_scope_count ?? doc.in_scope.length,
      deferred_count: doc.fm.deferred_count ?? doc.deferred.length,
      fm: doc.fm,
      file: fp
    });
  }
  return out;
}

export function getLatestSourcePullPlan(): PlanDoc | null {
  const files = listPlanFiles("source-pull-plan-");
  if (files.length === 0) return null;
  return parseSourcePullPlan(files[0]);
}

export function listPlanningDocs(): { name: string; file: string; mtime: number }[] {
  if (!fs.existsSync(PLAN_DIR)) return [];
  const entries = fs.readdirSync(PLAN_DIR, { withFileTypes: true });
  const out: { name: string; file: string; mtime: number }[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".md")) {
      const fp = path.join(PLAN_DIR, e.name);
      let mtime = 0;
      try {
        mtime = fs.statSync(fp).mtimeMs;
      } catch {
        // ignore
      }
      out.push({ name: e.name, file: fp, mtime });
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}
