/**
 * GET /api/jobs/stream  (Server-Sent Events)
 *
 * Emits a JSON snapshot of recent extraction_runs + jobs every ~3s. Connections
 * are capped at 10 minutes; client reconnects (EventSource handles this
 * automatically).
 *
 * Each event payload is a JobStreamSnapshot. Event names:
 *   - "snapshot"  — periodic state dump
 *   - "ping"      — keepalive (no payload)
 *
 * Consumers: run history page, extract submission page (live progress).
 */
import { NextRequest } from "next/server";
import { ensureStudioSchema } from "@/lib/db/client";
import { getJobStreamSnapshot } from "@/lib/pipeline/runs";

export const dynamic = "force-dynamic";
// Don't try to render on the edge; we depend on better-sqlite3.
export const runtime = "nodejs";

const TICK_MS = 3000;
const MAX_DURATION_MS = 10 * 60 * 1000; // 10 min

export async function GET(_req: NextRequest) {
  ensureStudioSchema();

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = Date.now();

      function send(event: string, data: unknown) {
        if (closed) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // controller already closed
          closed = true;
        }
      }

      // Send an initial snapshot immediately so the client has data to render.
      try {
        send("snapshot", getJobStreamSnapshot());
      } catch (err) {
        send("error", { message: (err as Error).message });
      }

      interval = setInterval(() => {
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          send("close", { reason: "max-duration" });
          closed = true;
          if (interval) clearInterval(interval);
          interval = null;
          try {
            controller.close();
          } catch {
            // already closed
          }
          return;
        }
        try {
          send("snapshot", getJobStreamSnapshot());
        } catch (err) {
          send("error", { message: (err as Error).message });
        }
      }, TICK_MS);
    },
    cancel() {
      // Client disconnected — stop the timer.
      closed = true;
      if (interval) clearInterval(interval);
      interval = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
