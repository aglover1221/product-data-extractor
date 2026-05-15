import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

let _studioDb: Database.Database | null = null;

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
 * Ensures the studio schema is loaded into the configured DB.
 * Safe to call repeatedly — uses CREATE TABLE IF NOT EXISTS throughout.
 *
 * Next.js bundles each server route into `.next/server/app/<route>/` so
 * `__dirname` doesn't point at lib/db/. We resolve from cwd (the project
 * root in both `next dev` and `next start`).
 */
export function ensureStudioSchema(): void {
  const db = getStudioDb();
  const sqlPath = path.resolve(process.cwd(), "lib/db/schema.sql");
  const ddl = fs.readFileSync(sqlPath, "utf8");
  db.exec(ddl);
}
