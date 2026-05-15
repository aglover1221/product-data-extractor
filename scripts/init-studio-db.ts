/**
 * Initializes the studio orchestrator DB by applying lib/db/schema.sql.
 *
 *   npm run studio:init
 *
 * Idempotent — safe to re-run. Existing tables + data are preserved.
 */
import { ensureStudioSchema, getStudioDb } from "@/lib/db/client";

ensureStudioSchema();
const db = getStudioDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all() as Array<{ name: string }>;

console.log(`studio db initialized — ${tables.length} tables present:`);
for (const t of tables) console.log(`  ${t.name}`);
