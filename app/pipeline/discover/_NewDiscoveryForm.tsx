"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewDiscoveryForm() {
  const router = useRouter();
  const [vendor, setVendor] = useState("Dell Technologies");
  const [portfolio, setPortfolio] = useState("");
  const [seedUrl, setSeedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor,
          portfolio,
          seedUrl: seedUrl || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(String(json?.error ?? `HTTP ${res.status}`));
        return;
      }
      router.push(`/pipeline/discover/${json.discoveryId}`);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel space-y-3">
      <div className="text-sm uppercase tracking-wide text-white/50 font-bold">New discovery</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs text-white/70 space-y-1">
          <div>Vendor</div>
          <input
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
            required
          />
        </label>
        <label className="text-xs text-white/70 space-y-1">
          <div>Portfolio (e.g. PowerEdge, Storage, Networking)</div>
          <input
            type="text"
            value={portfolio}
            onChange={(e) => setPortfolio(e.target.value)}
            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
            required
          />
        </label>
        <label className="text-xs text-white/70 space-y-1">
          <div>Seed URL (optional)</div>
          <input
            type="text"
            value={seedUrl}
            onChange={(e) => setSeedUrl(e.target.value)}
            placeholder="https://www.dell.com/..."
            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-sm"
          />
        </label>
      </div>
      {error && (
        <div className="text-xs text-red-300 border border-red-500/40 bg-red-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded bg-white/10 border border-white/20 text-sm hover:bg-white/15 disabled:opacity-50"
        >
          {busy ? "Discovering… (may take 1–3 min)" : "Run discovery"}
        </button>
        <span className="text-xs text-white/40">
          Synchronous: the request stays open until the LLM finishes its web_search loop.
        </span>
      </div>
    </form>
  );
}
