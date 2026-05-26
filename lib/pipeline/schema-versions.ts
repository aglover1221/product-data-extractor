/**
 * DB layer for schema version history.
 *
 * Wraps the `schemas` table from lib/db/schema.sql. The studio app's filesystem
 * is canonical for the *current* schema content; this table tracks every save
 * (and pre-studio seeding) so the UI can render history and diff between
 * arbitrary versions.
 *
 * Seeding: on first list-page render (or first save), call `seedFromFilesystemIfEmpty`
 * to import every on-disk schema MD as the initial v-row keyed by frontmatter version.
 */
import { ensureStudioSchema, getStudioDb } from "@/lib/db/client";
import fs from "node:fs";
import {
  listSchemaFiles,
  readSchemaContent,
  frontmatterVersion,
  writeSchemaContentAtomic,
  type SchemaFsRecord,
} from "@/lib/pipeline/schemas-fs";
import { parseMarkdown } from "@/lib/safe-matter";

export type SchemaVersionRow = {
  id: number;
  name: string;
  version: string;
  content_md: string;
  generated_from_json: string | null;
  parent_version_id: number | null;
  status: "draft" | "active" | "archived";
  created_at: string;
};

export type SchemaVersionSummary = Omit<SchemaVersionRow, "content_md">;

function nowIso(): string {
  return new Date().toISOString();
}

/** Idempotent seeding: insert one row per on-disk schema if `schemas` is empty. */
export function seedFromFilesystemIfEmpty(): { seeded: number } {
  ensureStudioSchema();
  const db = getStudioDb();
  const count = (db.prepare("SELECT COUNT(*) as c FROM schemas").get() as { c: number }).c;
  if (count > 0) return { seeded: 0 };

  const insert = db.prepare(`
    INSERT OR IGNORE INTO schemas (name, version, content_md, status, created_at)
    VALUES (?, ?, ?, 'active', ?)
  `);

  let seeded = 0;
  const txn = db.transaction((files: SchemaFsRecord[]) => {
    for (const rec of files) {
      const content = readSchemaContent(rec.name);
      if (content == null) continue;
      const result = insert.run(rec.name, rec.version, content, nowIso());
      if (result.changes > 0) seeded += 1;
    }
  });
  txn(listSchemaFiles());
  return { seeded };
}

export function listVersions(name: string): SchemaVersionSummary[] {
  ensureStudioSchema();
  const db = getStudioDb();
  const rows = db
    .prepare(
      `SELECT id, name, version, generated_from_json, parent_version_id, status, created_at
       FROM schemas WHERE name = ?
       ORDER BY id DESC`,
    )
    .all(name) as SchemaVersionSummary[];
  return rows;
}

export function getVersionByVersion(name: string, version: string): SchemaVersionRow | null {
  ensureStudioSchema();
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT id, name, version, content_md, generated_from_json, parent_version_id, status, created_at
       FROM schemas WHERE name = ? AND version = ?`,
    )
    .get(name, version) as SchemaVersionRow | undefined;
  return row ?? null;
}

export function getActiveVersion(name: string): SchemaVersionRow | null {
  ensureStudioSchema();
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT id, name, version, content_md, generated_from_json, parent_version_id, status, created_at
       FROM schemas WHERE name = ? AND status = 'active'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(name) as SchemaVersionRow | undefined;
  return row ?? null;
}

export function getLatestVersion(name: string): SchemaVersionRow | null {
  ensureStudioSchema();
  const db = getStudioDb();
  const row = db
    .prepare(
      `SELECT id, name, version, content_md, generated_from_json, parent_version_id, status, created_at
       FROM schemas WHERE name = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(name) as SchemaVersionRow | undefined;
  return row ?? null;
}

/**
 * Bump version logic. Picks the next version label given existing versions
 * and (optionally) a hint pulled from the saved frontmatter.
 *
 * Rules:
 *   - If the new content's frontmatter `schema_version` differs from the latest
 *     row's version (after normalizing) → use the frontmatter value verbatim.
 *   - Else: bump the existing version. "v1.1" → "v1.2"; "v2026-05-08" → "v2026-05-08-r2";
 *     non-conforming → fall back to a date-stamped suffix.
 */
export function nextVersion(name: string, newContent: string): string {
  const latest = getLatestVersion(name);
  let fmVersion = "v1.0";
  try {
    fmVersion = frontmatterVersion(parseMarkdown(newContent).data);
  } catch {
    // ignore — we'll fall back to a bump from latest
  }

  // If frontmatter declares a different version than the latest row, honor it
  // (and ensure uniqueness — append -rN if collision)
  if (latest && fmVersion !== latest.version) {
    return ensureUniqueVersion(name, fmVersion);
  }
  if (!latest) return ensureUniqueVersion(name, fmVersion);

  // Same frontmatter version → auto-bump
  const bumped = bumpLabel(latest.version);
  return ensureUniqueVersion(name, bumped);
}

function bumpLabel(label: string): string {
  // v1.1 → v1.2; v1 → v1.1; v0.1 → v0.2
  const semverLike = /^v(\d+)\.(\d+)$/i.exec(label);
  if (semverLike) {
    return `v${semverLike[1]}.${parseInt(semverLike[2], 10) + 1}`;
  }
  const justMajor = /^v(\d+)$/i.exec(label);
  if (justMajor) {
    return `v${justMajor[1]}.1`;
  }
  // Date-style: v2026-05-08 → today's date if different else add -r2
  const dateLike = /^v(\d{4}-\d{2}-\d{2})(?:-r(\d+))?$/.exec(label);
  if (dateLike) {
    const today = new Date().toISOString().slice(0, 10);
    if (dateLike[1] !== today) return `v${today}`;
    const r = dateLike[2] ? parseInt(dateLike[2], 10) + 1 : 2;
    return `v${today}-r${r}`;
  }
  // Fallback: append -r2 / increment
  const trailing = /-r(\d+)$/.exec(label);
  if (trailing) {
    return label.replace(/-r\d+$/, `-r${parseInt(trailing[1], 10) + 1}`);
  }
  return `${label}-r2`;
}

function ensureUniqueVersion(name: string, candidate: string): string {
  ensureStudioSchema();
  const db = getStudioDb();
  let v = candidate;
  let n = 2;
  // bounded loop
  while (
    db.prepare("SELECT 1 FROM schemas WHERE name = ? AND version = ?").get(name, v)
  ) {
    v = `${candidate}-r${n}`;
    n += 1;
    if (n > 99) break;
  }
  return v;
}

export type InsertVersionParams = {
  name: string;
  version: string;
  content_md: string;
  parent_version_id?: number | null;
  status?: "draft" | "active" | "archived";
  generated_from_json?: string | null;
};

export function insertVersion(p: InsertVersionParams): { id: number; version: string } {
  ensureStudioSchema();
  const db = getStudioDb();
  // Demote any prior active rows for this name to archived if we're inserting a new active.
  if ((p.status ?? "active") === "active") {
    db.prepare(
      `UPDATE schemas SET status = 'archived' WHERE name = ? AND status = 'active'`,
    ).run(p.name);
  }
  const result = db
    .prepare(
      `INSERT INTO schemas (name, version, content_md, generated_from_json, parent_version_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.name,
      p.version,
      p.content_md,
      p.generated_from_json ?? null,
      p.parent_version_id ?? null,
      p.status ?? "active",
      nowIso(),
    );
  return { id: Number(result.lastInsertRowid), version: p.version };
}

/**
 * Writes canonical schema content to disk and records the version row. If the
 * DB insert fails after the filesystem write, restores the previous on-disk
 * content so fs and DB stay aligned.
 */
export function saveSchemaVersionAtomic(
  rec: SchemaFsRecord,
  p: InsertVersionParams
): { id: number; version: string } {
  const previous = fs.readFileSync(rec.abs_path, "utf8");
  writeSchemaContentAtomic(rec, p.content_md);
  try {
    return insertVersion(p);
  } catch (err) {
    writeSchemaContentAtomic(rec, previous);
    throw err;
  }
}
