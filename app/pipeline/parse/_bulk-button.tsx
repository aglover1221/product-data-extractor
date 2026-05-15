"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BulkReparseButton({
  category,
  productLine,
  totalSources,
  unparsed,
}: {
  category: string;
  productLine: string;
  totalSources: number;
  unparsed: number;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function go(scope: "only-unparsed" | "all") {
    const count = scope === "only-unparsed" ? unparsed : totalSources;
    if (count === 0) {
      setMessage("nothing to do");
      return;
    }
    const eta = Math.round((count * 90) / 60);
    const cost = (count * 2 * 0.01).toFixed(2);
    const ok = window.confirm(
      `${scope === "only-unparsed" ? "Parse" : "Re-parse"} ${count} PDF${count === 1 ? "" : "s"} ` +
        `in ${category}/${productLine}?\n\n` +
        `Estimated wall-clock: ~${eta} min (Reducto ~90s/PDF)\n` +
        `Estimated cost: ~$${cost} (200 credits/PDF avg)`
    );
    if (!ok) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pipeline/parse/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, productLine, scope }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`error: ${data.error ?? res.statusText}`);
      } else {
        setMessage(`enqueued ${data.submitted} (${data.failed} failed)`);
        router.refresh();
      }
    } catch (e) {
      setMessage(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {unparsed > 0 && (
        <button
          onClick={() => go("only-unparsed")}
          disabled={busy}
          className="text-[11px] px-2 py-0.5 rounded border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          parse {unparsed} unparsed
        </button>
      )}
      <button
        onClick={() => go("all")}
        disabled={busy}
        className="text-[11px] px-2 py-0.5 rounded border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-50"
      >
        re-parse all {totalSources}
      </button>
      {message && <span className="text-[11px] text-white/60">{message}</span>}
    </div>
  );
}
