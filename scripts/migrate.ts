/**
 * Apply all pending migrations to the studio DB.
 *
 *   npm run migrate
 *
 * Idempotent — already-applied migrations are skipped. Drift in an applied
 * migration's checksum is a hard error.
 */
import { getStudioDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrations";

const db = getStudioDb();
const result = runMigrations(db);

if (result.adopted.length === 0 && result.appliedNow.length === 0) {
  console.log("migrate: nothing to do — schema is up to date.");
  process.exit(0);
}

for (const m of result.adopted) {
  console.log(`migrate: adopted ${m.name} (tables already present, recorded as applied)`);
}
for (const m of result.appliedNow) {
  console.log(`migrate: applied ${m.name}`);
}
