"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RunStatus = {
  annotationId: string;
  state: "queued" | "running" | "done" | "error";
  resolution?: string;
  message?: string;
};

/**
 * "Resolve all" — runs spot-fix sequentially across N open flags.
 * Each run lands in `pending-review` status; the user still reviews each via
 * the per-row spot-fix button (re-opens the modal). Bulk only kicks off the
 * agent run; it doesn't auto-accept.
 */
export default function BulkSpotfix({
  productSlug,
  annotationIds,
}: {
  productSlug: string;
  annotationIds: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RunStatus[]>([]);

  async function runAll() {
    if (busy) return;
    if (
      !confirm(
        `Run spot-fix on ${annotationIds.length} open flag${
          annotationIds.length === 1 ? "" : "s"
        }? Each run is queued as pending-review — you'll still accept/reject each one individually.`
      )
    ) {
      return;
    }
    setBusy(true);
    const initial: RunStatus[] = annotationIds.map((id) => ({
      annotationId: id,
      state: "queued",
    }));
    setProgress(initial);

    for (let i = 0; i < annotationIds.length; i++) {
      const id = annotationIds[i];
      setProgress((p) =>
        p.map((r) => (r.annotationId === id ? { ...r, state: "running" } : r))
      );
      try {
        const res = await fetch("/api/pipeline/spotfix", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ productSlug, annotationId: id }),
        });
        const j = await res.json();
        if (!res.ok) {
          setProgress((p) =>
            p.map((r) =>
              r.annotationId === id
                ? { ...r, state: "error", message: j.error ?? "failed" }
                : r
            )
          );
        } else {
          setProgress((p) =>
            p.map((r) =>
              r.annotationId === id
                ? { ...r, state: "done", resolution: j.resolution }
                : r
            )
          );
        }
      } catch (err: any) {
        setProgress((p) =>
          p.map((r) =>
            r.annotationId === id
              ? { ...r, state: "error", message: err.message }
              : r
          )
        );
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {progress.length > 0 && (
        <span className="text-[10px] text-white/50 font-mono">
          {progress.filter((p) => p.state === "done").length}/{progress.length} done
          {progress.filter((p) => p.state === "error").length > 0
            ? ` · ${progress.filter((p) => p.state === "error").length} error`
            : ""}
        </span>
      )}
      <button
        type="button"
        className="text-[11px] px-2 py-1 rounded bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
        onClick={runAll}
        disabled={busy || annotationIds.length === 0}
        title="Queue spot-fix for every open flag — each lands as pending-review"
      >
        {busy ? "running…" : `resolve all (${annotationIds.length})`}
      </button>
    </div>
  );
}
