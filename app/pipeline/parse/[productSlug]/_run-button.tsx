"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunButton({
  sourcePath,
  hasSidecar,
}: {
  sourcePath: string;
  hasSidecar: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function go() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pipeline/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePaths: [sourcePath] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`error: ${data.error ?? res.statusText}`);
      } else {
        const r = data.results?.[0];
        setMessage(r ? `enqueued #${r.parseRunId}` : "ok");
        router.refresh();
      }
    } catch (e) {
      setMessage(`error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const label = hasSidecar ? "re-run" : "run";
  const cls = hasSidecar
    ? "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
    : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20";

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={go}
        disabled={busy}
        className={`text-[11px] px-2 py-0.5 rounded border ${cls} disabled:opacity-50`}
      >
        {busy ? "…" : label}
      </button>
      {message && <span className="text-[11px] text-white/50">{message}</span>}
    </div>
  );
}
