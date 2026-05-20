/**
 * Smoke test for the durable job queue.
 *
 *   npx tsx scripts/queue-smoke-test.ts
 *
 * Points STUDIO_DB_PATH at a throwaway file under data/queue-smoke.db,
 * runs every migration against it, then exercises four scenarios:
 *
 *   1. Concurrent claim — many "workers" hammer claimNextJob in parallel;
 *      each row must be claimed by exactly one of them.
 *   2. Lease expiry — a job claimed with a 50ms lease becomes re-claimable
 *      after the lease passes; attempts increments on the reclaim.
 *   3. Dead-letter — repeated failures hit max_attempts and move to 'dead'.
 *   4. Idempotency — concurrent enqueue with the same key produces one
 *      row, and both callers see the same returned id.
 *
 * Uses the real queue module so any regression in queue.ts trips the test.
 * Process exits non-zero on first failure. Safe to re-run; the test DB is
 * recreated each invocation.
 */
import fs from "node:fs";
import path from "node:path";

// Point env at a dedicated test DB before any module imports it.
const DB_PATH = path.resolve(process.cwd(), "data", "queue-smoke.db");
process.env.STUDIO_DB_PATH = DB_PATH;

function wipe() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  for (const ext of ["", "-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

async function main() {
  wipe();

  // Dynamic-imported after env override so the client picks up the right path.
  const { getStudioDb, ensureStudioSchema } = await import("@/lib/db/client");
  const {
    claimNextJob,
    completeJob,
    enqueueJob,
    failJob,
    getJob,
  } = await import("@/lib/jobs/queue");

  ensureStudioSchema();
  const db = getStudioDb();

  let failures = 0;
  function check(name: string, cond: boolean, detail?: string) {
    if (cond) {
      console.log(`  ✓ ${name}`);
    } else {
      failures++;
      console.error(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
    }
  }
  function clearJobs() {
    db.exec(`DELETE FROM jobs`);
  }
  function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  // 1. Concurrent claim
  console.log("\n# concurrent claim — each row claimed exactly once");
  clearJobs();
  {
    const N = 50;
    const ids: number[] = [];
    for (let i = 0; i < N; i++) ids.push(enqueueJob("test-noop", { i }));

    // better-sqlite3 is sync, so "concurrent" here means many interleaved
    // claim calls under SQLite's write lock. That's exactly the contention
    // surface a multi-worker deployment would hit.
    const WORKERS = 8;
    const claimedJobs: number[] = [];
    let alive = true;
    while (alive) {
      alive = false;
      for (let w = 0; w < WORKERS; w++) {
        const job = claimNextJob({ leaseMs: 60_000 });
        if (job) {
          claimedJobs.push(job.id);
          alive = true;
        }
      }
    }
    const uniqueClaimed = new Set(claimedJobs);
    check("all jobs claimed", claimedJobs.length === N, `${claimedJobs.length}/${N}`);
    check(
      "no duplicate claims",
      uniqueClaimed.size === claimedJobs.length,
      `unique=${uniqueClaimed.size} total=${claimedJobs.length}`,
    );
    check("every job id claimed", uniqueClaimed.size === N);
  }

  // 2. Lease expiry
  console.log("\n# lease expiry → claimable again, attempts incremented");
  clearJobs();
  {
    const id = enqueueJob("test-stall", { x: 1 });
    const first = claimNextJob({ leaseMs: 50 });
    check("first claim succeeded", !!first && first.id === id);
    check("first attempt = 1", first?.attempts === 1);

    const racer = claimNextJob({ leaseMs: 1_000 });
    check("re-claim blocked while lease active", racer === null);

    await sleep(150);

    const reclaim = claimNextJob({ leaseMs: 1_000 });
    check("reclaim after lease expiry", !!reclaim && reclaim.id === id);
    check("reclaim bumped attempts to 2", reclaim?.attempts === 2);
  }

  // 3. Dead-letter
  console.log("\n# dead-letter after max_attempts retries");
  clearJobs();
  {
    const id = enqueueJob("test-fail", { x: 1 }, { maxAttempts: 3 });
    for (let i = 1; i <= 3; i++) {
      const j = claimNextJob({ leaseMs: 60_000 });
      check(`attempt ${i} claimed`, !!j && j.id === id);
      const result = failJob(id, `boom ${i}`);
      if (i < 3) {
        check(`attempt ${i} schedules retry`, result === "pending");
      } else {
        check(`attempt ${i} moves to dead`, result === "dead");
      }
      // Drag retries forward so the next claim sees them eligible.
      if (i < 3) {
        db.prepare(`UPDATE jobs SET next_run_at = NULL WHERE id = ?`).run(id);
      }
    }
    const final = getJob(id);
    check("final status is dead", final?.status === "dead");
    check("dead row has last_error", final?.last_error === "boom 3");

    const ghost = claimNextJob({ leaseMs: 60_000 });
    check("dead job is not claimable", ghost === null);
  }

  // 4. Idempotency
  console.log("\n# idempotency key — duplicate enqueue is a no-op");
  clearJobs();
  {
    const key = "anthropic-batch-poll:msgbatch_xyz";
    const a = enqueueJob("anthropic-batch-poll", { runId: 1 }, { idempotencyKey: key });
    const b = enqueueJob("anthropic-batch-poll", { runId: 1 }, { idempotencyKey: key });
    const c = enqueueJob("anthropic-batch-poll", { runId: 1 }, { idempotencyKey: key });
    check("all three returned the same id", a === b && b === c, `a=${a} b=${b} c=${c}`);

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE idempotency_key = ?`)
      .get(key) as { n: number };
    check("only one row exists for this key", count.n === 1, `n=${count.n}`);

    const claimed = claimNextJob({ leaseMs: 60_000 });
    completeJob(claimed!.id);
    const d = enqueueJob("anthropic-batch-poll", { runId: 1 }, { idempotencyKey: key });
    check("post-completion re-enqueue creates a new row", d !== a, `a=${a} d=${d}`);
  }

  console.log(failures === 0 ? "\nall good." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
