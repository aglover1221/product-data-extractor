import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { runMigrations } from "@/lib/db/migrations";

let _studioDb: Database.Database | null = null;
let _migrated = false;

export function getStudioDb(): Database.Database {
  if (_studioDb) return _studioDb;
  const dbPath = path.resolve(process.cwd(), env.STUDIO_DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _studioDb = new Database(dbPath, { readonly: false });
  _studioDb.pragma("journal_mode = WAL");
  _studioDb.pragma("foreign_keys = ON");
  return _studioDb;
}

/**
 * Ensures the studio schema is up to date by running any pending migrations
 * from `lib/db/migrations/`. Safe to call repeatedly — applied migrations
 * are tracked in `schema_migrations` and a once-per-process cache short-
 * circuits subsequent calls within the same Node worker.
 *
 * Existing databases that pre-date the migration system are adopted on first
 * run: if the tables from `0001_init.sql` already exist, the runner records
 * 0001 as applied without re-executing it.
 */
export function ensureStudioSchema(): void {
  if (_migrated) return;
  runMigrations(getStudioDb());
  _migrated = true;
}
