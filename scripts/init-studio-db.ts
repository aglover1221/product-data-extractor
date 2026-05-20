/**
 * Initializes the studio orchestrator DB by running all pending migrations.
 *
 *   npm run studio:init
 *
 * Idempotent — safe to re-run. Existing tables + data are preserved.
 * Equivalent to `npm run migrate` plus a summary of resulting tables; kept
 * as a separate entry point because it's what the README's "getting started"
 * instructions point at.
 */
import { ensureStudioSchema, getStudioDb } from "@/lib/db/client";

ensureStudioSchema();
const db = getStudioDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all() as Array<{ name: string }>;

console.log(`studio db initialized — ${tables.length} tables present:`);
for (const t of tables) console.log(`  ${t.name}`);
