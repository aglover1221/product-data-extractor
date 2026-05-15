"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface DiscoveredProduct {
  id: number;
  vendor: string;
  product_line: string;
  slug: string;
  marketing_name: string | null;
  candidate_url: string | null;
  approval_status: string;
  approved_at: string | null;
}

interface RawProduct {
  vendor?: string;
  product_line?: string;
  category?: string;
  slug?: string;
  canonical_name?: string;
  marketing_name?: string | null;
  candidate_url?: string | null;
}

export default function DiscoveryApprovalView({
  discoveryId,
  products,
  rawProducts,
}: {
  discoveryId: number;
  products: DiscoveredProduct[];
  rawProducts: RawProduct[];
}) {
  const router = useRouter();
  const initialSelected = useMemo(() => {
    const s = new Set<number>();
    for (const p of products) {
      if (p.approval_status === "pending") s.add(p.id);
    }
    return s;
  }, [products]);
  const [selected, setSelected] = useState<Set<number>>(initialSelected);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rawByKey = useMemo(() => {
    const m = new Map<string, RawProduct>();
    for (const r of rawProducts) {
      m.set(`${r.product_line}/${r.slug}`, r);
    }
    return m;
  }, [rawProducts]);

  const groups = useMemo(() => {
    const g = new Map<string, DiscoveredProduct[]>();
    for (const p of products) {
      const key = p.product_line;
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(p);
    }
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllPending() {
    const next = new Set<number>();
    for (const p of products) if (p.approval_status === "pending") next.add(p.id);
    setSelected(next);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function approveSelected() {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/pipeline/discover/${discoveryId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productIds: [...selected] }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(String(json?.error ?? `HTTP ${res.status}`));
        return;
      }
      setMessage(
        `Approved ${json.approvedCount}; created ${json.created.filter((c: any) => c.created).length} new MD skeleton(s).`
      );
      setSelected(new Set());
      router.refresh();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={selectAllPending}
          disabled={busy}
          className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs hover:bg-white/10"
        >
          Select all pending
        </button>
        <button
          onClick={clearSelection}
          disabled={busy}
          className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs hover:bg-white/10"
        >
          Clear selection
        </button>
        <button
          onClick={approveSelected}
          disabled={busy || selected.size === 0}
          className="px-3 py-1 rounded bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {busy
            ? "Approving…"
            : `Approve ${selected.size} ${selected.size === 1 ? "product" : "products"}`}
        </button>
        <span className="text-xs text-white/40 ml-2">
          On approve, MD skeletons are written to disk under{" "}
          <code className="font-mono">{`{category}/{vendor}/{line}/{slug}/{slug}.md`}</code>.
        </span>
      </div>

      {error && (
        <div className="text-xs text-red-300 border border-red-500/40 bg-red-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      {message && (
        <div className="text-xs text-emerald-200 border border-emerald-500/40 bg-emerald-500/10 rounded px-2 py-1">
          {message}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="panel text-sm text-white/60">No discovered products.</div>
      ) : (
        groups.map(([line, rows]) => (
          <div key={line} className="panel overflow-x-auto">
            <div className="text-sm uppercase tracking-wide text-white/50 mb-2">
              {line}{" "}
              <span className="text-white/30 font-normal">
                ({rows.length} {rows.length === 1 ? "product" : "products"})
              </span>
            </div>
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Slug</th>
                  <th>Canonical name</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const r = rawByKey.get(`${p.product_line}/${p.slug}`);
                  const checked = selected.has(p.id);
                  const disabled = p.approval_status !== "pending" || busy;
                  return (
                    <tr key={p.id} className="hover:bg-white/[0.04]">
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(p.id)}
                          disabled={disabled}
                        />
                      </td>
                      <td className="font-mono text-xs">{p.slug}</td>
                      <td>{r?.canonical_name ?? p.marketing_name ?? p.slug}</td>
                      <td className="text-white/60 text-xs">{r?.category ?? "—"}</td>
                      <td>
                        <span className="chip">{p.approval_status}</span>
                      </td>
                      <td className="text-xs text-white/50 truncate max-w-[280px]">
                        {p.candidate_url ? (
                          <a
                            href={p.candidate_url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-white"
                          >
                            {p.candidate_url}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
