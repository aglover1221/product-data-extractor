import fs from "node:fs";
import path from "node:path";
import { parseMarkdown } from "./safe-matter";
import { REPO_ROOT } from "./repo-walk";

const SCHEMA_DIR = path.join(REPO_ROOT, "schemas");
const OVERLAY_DIR = path.join(SCHEMA_DIR, "overlays");

export type SchemaFrontmatter = {
  name?: string;
  description?: string;
  type?: string;
  category?: string;
  parent?: string;
  applies_when?: string;
  last_updated?: string;
  [key: string]: any;
};

export type SchemaTable = {
  headers: string[];
  rows: string[][];
};

export type SchemaSection = {
  heading: string;
  level: number;
  prose: string;
  tables: SchemaTable[];
};

export type SchemaDoc = {
  name: string; // file name without ext
  file: string;
  is_overlay: boolean;
  fm: SchemaFrontmatter;
  body: string;
  sections: SchemaSection[];
};

export type SchemaSummary = {
  name: string;
  file: string;
  is_overlay: boolean;
  fm: SchemaFrontmatter;
  section_count: number;
  field_count: number;
};

function listSchemaFiles(): { file: string; isOverlay: boolean }[] {
  const out: { file: string; isOverlay: boolean }[] = [];
  if (fs.existsSync(SCHEMA_DIR)) {
    for (const e of fs.readdirSync(SCHEMA_DIR, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md") && !e.name.includes(".v") && !e.name.endsWith("-fill-report.md")) {
        out.push({ file: path.join(SCHEMA_DIR, e.name), isOverlay: false });
      }
    }
  }
  if (fs.existsSync(OVERLAY_DIR)) {
    for (const e of fs.readdirSync(OVERLAY_DIR, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".md")) {
        out.push({ file: path.join(OVERLAY_DIR, e.name), isOverlay: true });
      }
    }
  }
  return out;
}

function parseTable(lines: string[]): SchemaTable | null {
  // Expect at least: header row, separator row, ≥0 body rows
  if (lines.length < 2) return null;
  const splitRow = (r: string) =>
    r
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const headers = splitRow(lines[0]);
  if (!/^\s*\|?\s*[-:]+\s*\|/.test(lines[1])) return null;
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    rows.push(splitRow(lines[i]));
  }
  return { headers, rows };
}

function parseSections(body: string): SchemaSection[] {
  const lines = body.split("\n");
  const sections: SchemaSection[] = [];
  let cur: SchemaSection | null = null;
  let proseBuf: string[] = [];
  let tableBuf: string[] = [];
  let inTable = false;

  const flushTable = () => {
    if (!cur || tableBuf.length === 0) {
      tableBuf = [];
      return;
    }
    const tbl = parseTable(tableBuf);
    if (tbl) cur.tables.push(tbl);
    else proseBuf.push(...tableBuf);
    tableBuf = [];
  };
  const flushSection = () => {
    if (!cur) return;
    flushTable();
    cur.prose = proseBuf.join("\n").trim();
    sections.push(cur);
    cur = null;
    proseBuf = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flushSection();
      cur = {
        level: headingMatch[1].length,
        heading: headingMatch[2],
        prose: "",
        tables: []
      };
      inTable = false;
      continue;
    }
    if (!cur) continue;

    const isTableLine = /^\s*\|.+\|\s*$/.test(line);
    if (isTableLine) {
      if (!inTable) inTable = true;
      tableBuf.push(line);
    } else {
      if (inTable) {
        flushTable();
        inTable = false;
      }
      proseBuf.push(line);
    }
  }
  flushSection();

  return sections;
}

export function parseSchema(file: string, isOverlay: boolean): SchemaDoc | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const parsed = parseMarkdown(raw);
  const fm = parsed.data as SchemaFrontmatter;
  const body = parsed.content;
  const sections = parseSections(body);
  return {
    name: path.basename(file, ".md"),
    file,
    is_overlay: isOverlay,
    fm,
    body,
    sections
  };
}

function countFields(sections: SchemaSection[]): number {
  let n = 0;
  for (const s of sections) {
    for (const t of s.tables) {
      // Heuristic: a "field table" has Field as the first column
      const first = (t.headers[0] || "").toLowerCase();
      if (first.includes("field")) n += t.rows.length;
    }
  }
  return n;
}

export function listSchemas(): SchemaSummary[] {
  const out: SchemaSummary[] = [];
  for (const { file, isOverlay } of listSchemaFiles()) {
    const doc = parseSchema(file, isOverlay);
    if (!doc) continue;
    out.push({
      name: doc.name,
      file,
      is_overlay: isOverlay,
      fm: doc.fm,
      section_count: doc.sections.length,
      field_count: countFields(doc.sections)
    });
  }
  return out.sort((a, b) => Number(a.is_overlay) - Number(b.is_overlay) || a.name.localeCompare(b.name));
}

export function getSchema(name: string): SchemaDoc | null {
  for (const { file, isOverlay } of listSchemaFiles()) {
    if (path.basename(file, ".md") === name) {
      return parseSchema(file, isOverlay);
    }
  }
  return null;
}

/** True if a table looks like a "field table" (first header is Field). */
export function isFieldTable(t: SchemaTable): boolean {
  return (t.headers[0] || "").toLowerCase().trim() === "field";
}
