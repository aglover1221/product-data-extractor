/**
 * Show which migrations are applied vs pending, and flag drift.
 *
 *   npm run migrate:status
 *
 * Exits 0 when up-to-date, 1 when any pending/drift/missing rows exist —
 * suitable for a "fail the build if a dev forgot to commit a migration"
 * pre-merge check.
 */
import { getStudioDb } from "@/lib/db/client";
import { getStatus } from "@/lib/db/migrations";

const status = getStatus(getStudioDb());

console.log(`applied: ${status.applied.length}`);
for (const a of status.applied) {
  const drift = status.drifted.find((d) => d.applied.name === a.name);
  const marker = drift ? "  [DRIFT]" : "";
  console.log(`  ✓ ${a.name}  ${a.applied_at}${marker}`);
}

if (status.pending.length > 0) {
  console.log(`\npending: ${status.pending.length}`);
  for (const p of status.pending) console.log(`  · ${p.name}`);
}

if (status.missing.length > 0) {
  console.log(`\nmissing from disk: ${status.missing.length}`);
  for (const m of status.missing) console.log(`  ? ${m.name}  (recorded ${m.applied_at})`);
}

if (status.drifted.length > 0) {
  console.log(`\ndrift: ${status.drifted.length}`);
  for (const d of status.drifted) {
    console.log(
      `  ! ${d.applied.name}: applied=${d.applied.checksum.slice(0, 12)} disk=${d.file.checksum.slice(0, 12)}`,
    );
  }
}

const dirty = status.pending.length + status.drifted.length + status.missing.length;
if (dirty === 0) console.log("\nup to date.");
process.exit(dirty === 0 ? 0 : 1);
