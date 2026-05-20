/**
 * Tiny migration runner for the studio orchestrator DB.
 *
 * Migrations live in `lib/db/migrations/` as numbered .sql files
 * (`NNNN_name.sql`). They are applied in filename order inside a transaction,
 * one transaction per file, and recorded in `schema_migrations`.
 *
 * The runner verifies checksums of already-applied migrations on every run so
 * a developer editing a migration after it's been applied gets a loud error
 * instead of silent drift.
 *
 * No rollback. SQLite databases are single files — restore from a backup or
 * `rm data/studio.db` and re-run. The orchestrator DB is also rebuildable
 * from filesystem state via `npm run studio:seed`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export type MigrationFile = {
  /** Numeric id parsed from filename prefix, e.g. `0001` -> 1. */
  id: number;
  /** Full filename without extension, e.g. `0001_init`. */
  name: string;
  /** Absolute path on disk. */
  filepath: string;
  /** Raw SQL text. */
  sql: string;
  /** SHA-256 of the raw SQL bytes, hex. */
  checksum: string;
};

export type AppliedMigration = {
  id: number;
  name: string;
  checksum: string;
  applied_at: string;
};

export type MigrationStatus = {
  applied: AppliedMigration[];
  pending: MigrationFile[];
  /** Migrations applied to the DB but missing from disk. */
  missing: AppliedMigration[];
  /** Applied migrations whose on-disk checksum no longer matches. */
  drifted: Array<{ applied: AppliedMigration; file: MigrationFile }>;
};

const MIGRATIONS_DIR = path.resolve(process.cwd(), "lib/db/migrations");
const FILENAME_RE = /^(\d{4,})_([a-z0-9_-]+)\.sql$/i;

/** Read and parse every `NNNN_name.sql` under `lib/db/migrations/`. */
export function discoverMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const match = FILENAME_RE.exec(entry);
    if (!match) {
      throw new Error(
        `Invalid migration filename: ${entry}. Expected NNNN_name.sql (e.g. 0002_add_widgets.sql).`,
      );
    }
    const id = Number.parseInt(match[1], 10);
    const filepath = path.join(dir, entry);
    const sql = fs.readFileSync(filepath, "utf8");
    files.push({
      id,
      name: entry.replace(/\.sql$/, ""),
      filepath,
      sql,
      checksum: sha256(sql),
    });
  }
  files.sort((a, b) => a.id - b.id);

  // Guard against duplicate ids — easy to do by accident when branching.
  for (let i = 1; i < files.length; i++) {
    if (files[i].id === files[i - 1].id) {
      throw new Error(
        `Duplicate migration id ${files[i].id}: ${files[i - 1].name} and ${files[i].name}`,
      );
    }
  }
  return files;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      checksum    TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `);
}

function loadApplied(db: Database.Database): AppliedMigration[] {
  return db
    .prepare("SELECT id, name, checksum, applied_at FROM schema_migrations ORDER BY id")
    .all() as AppliedMigration[];
}

/**
 * Heuristic: does this DB already carry the schema from 0001_init.sql without
 * having a `schema_migrations` row for it?
 *
 * True when the `schema_migrations` table didn't exist before this run AND
 * the tables created in 0001 (e.g. `discoveries`) are already present. In
 * that case we adopt the DB by inserting the 0001 row without re-executing,
 * which would otherwise be a no-op (every CREATE is `IF NOT EXISTS`) but
 * would still wedge any user who later edits 0001's checksum to match a
 * legitimate change.
 *
 * Returns the set of table names from the migration that already exist, so
 * the caller can decide whether to adopt or run.
 */
function existingTableSet(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** SQL `CREATE TABLE ...` table-name extractor. Loose but good enough. */
function tablesCreatedBy(sql: string): string[] {
  const out: string[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.push(m[1]);
  return out;
}

/**
 * Compute pending/applied/drift state without modifying the DB.
 *
 * `schema_migrations` is created on the fly here so callers don't need to
 * run migrations first to read status — that would defeat the purpose of a
 * status command.
 */
export function getStatus(db: Database.Database): MigrationStatus {
  ensureMigrationsTable(db);
  const files = discoverMigrations();
  const applied = loadApplied(db);
  const appliedByName = new Map(applied.map((a) => [a.name, a]));
  const fileByName = new Map(files.map((f) => [f.name, f]));

  const pending: MigrationFile[] = [];
  const drifted: Array<{ applied: AppliedMigration; file: MigrationFile }> = [];
  for (const file of files) {
    const rec = appliedByName.get(file.name);
    if (!rec) {
      pending.push(file);
      continue;
    }
    if (rec.checksum !== file.checksum) {
      drifted.push({ applied: rec, file });
    }
  }

  const missing: AppliedMigration[] = applied.filter((a) => !fileByName.has(a.name));
  return { applied, pending, missing, drifted };
}

export type MigrateResult = {
  appliedNow: MigrationFile[];
  adopted: MigrationFile[];
};

/**
 * Apply all pending migrations.
 *
 * - Verifies checksums of already-applied migrations and throws on drift.
 * - If no migrations have ever been applied AND the first pending migration's
 *   tables are already present, adopts it without re-executing (existing-
 *   database upgrade path). Gated on "no applied rows" rather than "table
 *   didn't exist" so that running `migrate:status` first — which lazily
 *   creates the table — doesn't disable adoption.
 * - Each migration runs in its own transaction so a partial failure doesn't
 *   leave the DB half-migrated relative to `schema_migrations`.
 */
export function runMigrations(db: Database.Database): MigrateResult {
  const beforeTables = existingTableSet(db);

  ensureMigrationsTable(db);

  const { applied, pending, drifted, missing } = getStatus(db);

  if (drifted.length > 0) {
    const lines = drifted.map(
      (d) =>
        `  - ${d.applied.name}: applied checksum ${short(d.applied.checksum)}, on-disk ${short(d.file.checksum)}`,
    );
    throw new Error(
      `Migration drift detected — these files differ from what was applied:\n${lines.join("\n")}\n` +
        `Either revert the file or create a new migration for the change.`,
    );
  }
  if (missing.length > 0) {
    // Don't throw — this often happens during git branch switches between
    // PRs that add migrations. But we do warn loudly.
    console.warn(
      `migrate: ${missing.length} applied migration(s) missing from disk: ${missing.map((m) => m.name).join(", ")}`,
    );
  }

  const insert = db.prepare(
    "INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
  );

  const appliedNow: MigrationFile[] = [];
  const adopted: MigrationFile[] = [];

  for (const file of pending) {
    const shouldAdopt =
      applied.length === 0 &&
      appliedNow.length === 0 &&
      adopted.length === 0 &&
      file.id === pending[0].id &&
      tablesCreatedBy(file.sql).every((t) => beforeTables.has(t)) &&
      tablesCreatedBy(file.sql).length > 0;

    const tx = db.transaction(() => {
      if (!shouldAdopt) db.exec(file.sql);
      insert.run(file.id, file.name, file.checksum, new Date().toISOString());
    });
    tx();

    if (shouldAdopt) adopted.push(file);
    else appliedNow.push(file);
  }

  return { appliedNow, adopted };
}

function short(hex: string): string {
  return hex.slice(0, 12);
}
