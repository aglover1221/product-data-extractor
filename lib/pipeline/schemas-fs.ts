/**
 * Filesystem layer for schema MDs.
 *
 * The data dir at PRODUCT_MCP_DATA_DIR/schemas/ is canonical:
 *   - schemas/{name}.md             — base schemas
 *   - schemas/overlays/{name}.md    — additive overlays
 *
 * Studio reads these to drive the editor and writes back atomically
 * (temp file + rename) when a save lands. The DB tracks version history
 * but never replaces the filesystem as source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { parseMarkdown } from "@/lib/safe-matter";

const REPO_ROOT = path.resolve(env.PRODUCT_MCP_DATA_DIR);
const SCHEMA_DIR = path.join(REPO_ROOT, "schemas");
const OVERLAY_DIR = path.join(SCHEMA_DIR, "overlays");

export type SchemaFsRecord = {
  name: string;
  is_overlay: boolean;
  abs_path: string;
  rel_path: string; // relative to PRODUCT_MCP_DATA_DIR (e.g. "schemas/server.md")
  version: string; // from frontmatter or "v1.0" default
  last_updated: string | null;
  description: string | null;
  size_bytes: number;
  mtime_ms: number;
};

function listFiles(): { abs: string; isOverlay: boolean }[] {
  const out: { abs: string; isOverlay: boolean }[] = [];
  if (fs.existsSync(SCHEMA_DIR)) {
    for (const entry of fs.readdirSync(SCHEMA_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      // Skip versioned snapshots and fill reports kept under schemas/
      if (entry.name.includes(".v")) continue;
      if (entry.name.endsWith("-fill-report.md")) continue;
      out.push({ abs: path.join(SCHEMA_DIR, entry.name), isOverlay: false });
    }
  }
  if (fs.existsSync(OVERLAY_DIR)) {
    for (const entry of fs.readdirSync(OVERLAY_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      out.push({ abs: path.join(OVERLAY_DIR, entry.name), isOverlay: true });
    }
  }
  return out;
}

/** Pull "schema_version" → version from frontmatter, normalized to "vX.Y" form. */
export function frontmatterVersion(fm: Record<string, any>): string {
  const raw =
    fm.schema_version ??
    fm.version ??
    fm.schemaVersion ??
    fm.last_updated ??
    null;
  if (!raw) return "v1.0";
  const s = String(raw).trim();
  if (!s) return "v1.0";
  // Already prefixed with v?
  if (/^v[\d]/i.test(s)) return s;
  // Looks like a date — keep as-is, prefixed
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `v${s}`;
  // Numeric (e.g. "1.1" or "1") → vX.Y
  if (/^\d+(\.\d+)?$/.test(s)) return `v${s}`;
  // Anything else — pass through prefixed
  return `v${s}`;
}

export function listSchemaFiles(): SchemaFsRecord[] {
  const out: SchemaFsRecord[] = [];
  for (const { abs, isOverlay } of listFiles()) {
    const stat = fs.statSync(abs);
    const raw = fs.readFileSync(abs, "utf8");
    const { data: fm } = parseMarkdown(raw);
    const name = path.basename(abs, ".md");
    out.push({
      name,
      is_overlay: isOverlay,
      abs_path: abs,
      rel_path: path.relative(REPO_ROOT, abs),
      version: frontmatterVersion(fm),
      last_updated: fm.last_updated ? String(fm.last_updated) : null,
      description: fm.description ? String(fm.description) : null,
      size_bytes: stat.size,
      mtime_ms: stat.mtimeMs,
    });
  }
  return out.sort(
    (a, b) =>
      Number(a.is_overlay) - Number(b.is_overlay) || a.name.localeCompare(b.name),
  );
}

export function findSchemaFile(name: string): SchemaFsRecord | null {
  return listSchemaFiles().find((s) => s.name === name) ?? null;
}

export function readSchemaContent(name: string): string | null {
  const rec = findSchemaFile(name);
  if (!rec) return null;
  return fs.readFileSync(rec.abs_path, "utf8");
}

/** Writes content_md atomically — temp file in same dir + rename. */
export function writeSchemaContentAtomic(rec: SchemaFsRecord, content: string): void {
  const dir = path.dirname(rec.abs_path);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${rec.abs_path}.tmp.${Date.now()}.${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, rec.abs_path);
}

/** True if a schema file exists on disk. */
export function schemaExists(name: string): boolean {
  return findSchemaFile(name) != null;
}

/** Returns the set of schema names currently on disk (base + overlay). */
export function knownSchemaNames(): Set<string> {
  return new Set(listSchemaFiles().map((s) => s.name));
}
