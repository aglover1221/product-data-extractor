"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SpotfixResult = {
  runId: number;
  resolution: "fixed" | "wont-fix" | "open-with-analysis";
  before: any;
  after: any;
  rationale: string;
  evidence: {
    source: string;
    anchor?: string;
    page?: number;
    quote?: string;
    confidence?: number;
  } | null;
  status: "pending-review" | "failed";
  costUsd: number;
};

function snippet(value: any): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function SpotfixButton({
  productSlug,
  annotationId,
  size = "md",
  onResolved,
}: {
  productSlug: string;
  annotationId: string;
  size?: "sm" | "md";
  onResolved?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpotfixResult | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/pipeline/spotfix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productSlug, annotationId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `spot-fix failed: ${res.status}`);
      setResult(j as SpotfixResult);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!result) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pipeline/spotfix/${result.runId}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: result.evidence ?? undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `accept failed: ${res.status}`);
      setResult(null);
      onResolved?.();
      router.refresh();
    } catch (err: any) {
      alert(`Accept failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!result) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pipeline/spotfix/${result.runId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `reject failed: ${res.status}`);
      setResult(null);
      onResolved?.();
      router.refresh();
    } catch (err: any) {
      alert(`Reject failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    setResult(null);
    await start();
  }

  const btnClass =
    size === "sm"
      ? "text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50"
      : "text-[11px] px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        className={btnClass}
        onClick={start}
        disabled={busy}
        title="Run spot-fix: have the agent re-read the source for this field"
      >
        {busy && !result ? "spot-fixing…" : "spot-fix"}
      </button>
      {error && (
        <span className="ml-2 text-[10px] text-rose-300" title={error}>
          error: {error.slice(0, 80)}
        </span>
      )}

      {result && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-12 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setResult(null);
          }}
        >
          <div className="bg-zinc-900 border border-white/10 rounded-md shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 text-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/50">
                  Spot-fix · run #{result.runId}
                </div>
                <div className="font-mono text-[12px] text-white/80">
                  {productSlug}
                </div>
              </div>
              <button
                className="text-white/50 hover:text-white text-xs"
                onClick={() => setResult(null)}
              >
                close
              </button>
            </div>

            <div className="mb-3">
              <span
                className={`pill ${
                  result.resolution === "fixed"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : result.resolution === "wont-fix"
                    ? "bg-zinc-500/15 text-zinc-300"
                    : "bg-amber-400/15 text-amber-300"
                }`}
              >
                {result.resolution}
              </span>
              <span className="ml-2 text-[10px] text-white/40 font-mono">
                cost ${result.costUsd.toFixed(4)}
              </span>
              {result.status === "failed" && (
                <span className="ml-2 pill bg-rose-500/15 text-rose-300">failed</span>
              )}
            </div>

            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">
                Rationale
              </div>
              <div className="text-[12px] text-white/85 whitespace-pre-wrap leading-snug">
                {result.rationale}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">
                  Before
                </div>
                <pre className="bg-zinc-950 border border-white/10 rounded p-2 text-[11px] text-white/80 max-h-72 overflow-auto">
                  {snippet(result.before)}
                </pre>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">
                  After {result.resolution !== "fixed" && "(no change)"}
                </div>
                <pre className="bg-zinc-950 border border-white/10 rounded p-2 text-[11px] text-emerald-300/90 max-h-72 overflow-auto">
                  {result.resolution === "fixed" ? snippet(result.after) : "—"}
                </pre>
              </div>
            </div>

            {result.evidence && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">
                  Evidence
                </div>
                <div className="bg-zinc-950 border border-white/10 rounded p-2 text-[11px] text-white/75 space-y-1">
                  <div>
                    <span className="text-white/40">source: </span>
                    <span className="font-mono">{result.evidence.source}</span>
                  </div>
                  {result.evidence.anchor && (
                    <div>
                      <span className="text-white/40">anchor: </span>
                      {result.evidence.anchor}
                    </div>
                  )}
                  {result.evidence.page != null && (
                    <div>
                      <span className="text-white/40">page: </span>
                      {result.evidence.page}
                    </div>
                  )}
                  {result.evidence.quote && (
                    <div>
                      <span className="text-white/40">quote: </span>
                      <span className="italic">"{result.evidence.quote}"</span>
                    </div>
                  )}
                  {result.evidence.confidence != null && (
                    <div>
                      <span className="text-white/40">confidence: </span>
                      {result.evidence.confidence}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
              <button
                className="text-[11px] px-3 py-1 rounded text-white/60 hover:text-white hover:bg-white/5"
                onClick={rerun}
                disabled={busy}
              >
                re-run
              </button>
              <button
                className="text-[11px] px-3 py-1 rounded bg-zinc-700/50 text-white/70 hover:bg-zinc-700 disabled:opacity-50"
                onClick={reject}
                disabled={busy}
              >
                reject
              </button>
              <button
                className="text-[11px] px-3 py-1 rounded bg-emerald-600/40 text-emerald-100 hover:bg-emerald-600/60 disabled:opacity-50"
                onClick={accept}
                disabled={busy || result.resolution !== "fixed"}
                title={
                  result.resolution !== "fixed"
                    ? "Only resolution=fixed runs can be accepted"
                    : "Apply this change to extraction.json and resolve the annotation"
                }
              >
                accept
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
