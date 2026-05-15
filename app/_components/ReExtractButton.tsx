"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Single-product re-extract button. POSTs to /api/pipeline/extract with one
 * product, surfaces dry-run cost first, then submits on confirmation.
 *
 * Used in two places:
 *   - run-detail per-product table (failed/completed rows)
 *   - product detail page header (re-extract this product)
 */
export default function ReExtractButton({
  productSlug,
  category,
  label = "Re-extract",
  className = "px-2 py-0.5 rounded text-[11px] bg-white/5 hover:bg-white/10 text-white/80 border border-white/10",
}: {
  productSlug: string;
  category: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setErr(null);
    setBusy(true);
    try {
      // Dry-run first to surface cost.
      const dryRes = await fetch("/api/pipeline/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          products: [productSlug],
          dryRun: true,
        }),
      });
      const dry = await dryRes.json().catch(() => ({}));
      if (!dryRes.ok) {
        setErr(dry?.error ?? `dry-run failed: ${dryRes.status}`);
        return;
      }
      const cost = Number(dry.costEstimateUsd ?? 0);
      const ok = confirm(
        `Re-extract ${productSlug}?\nEstimate: $${cost.toFixed(4)}`
      );
      if (!ok) return;

      const res = await fetch("/api/pipeline/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          products: [productSlug],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error ?? `submit failed: ${res.status}`);
        return;
      }
      if (data.runId) {
        router.push(`/pipeline/runs/${data.runId}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={`${className} disabled:opacity-50`}
      >
        {busy ? "submitting…" : label}
      </button>
      {err && (
        <span className="text-[11px] text-rose-300" title={err}>
          {err.length > 60 ? `${err.slice(0, 60)}…` : err}
        </span>
      )}
    </span>
  );
}
