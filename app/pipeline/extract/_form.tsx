"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface ProductOption {
  category: string;
  line: string;
  slug: string;
  productPathRel: string;
  hasExtraction: boolean;
}

export interface ExtractFormProps {
  categories: string[];
  productsByCategory: Record<string, ProductOption[]>;
  defaultCategory: string;
  defaultProducts?: string[];
  schemaVersion: string;
  maxRunUsd: number;
}

interface DryRunPerProduct {
  slug: string;
  totalInputTokens: number;
}

interface DryRunResult {
  costEstimateUsd: number;
  coldUsd: number;
  warmUsdEach: number;
  productCount: number;
  perProduct: DryRunPerProduct[];
  maxRunUsd: number;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export default function ExtractForm(props: ExtractFormProps) {
  const router = useRouter();
  const {
    categories,
    productsByCategory,
    defaultCategory,
    defaultProducts,
    schemaVersion,
    maxRunUsd,
  } = props;

  const [category, setCategory] = useState(
    categories.includes(defaultCategory) ? defaultCategory : categories[0] ?? ""
  );
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (defaultProducts && defaultProducts.length > 0) {
      return new Set(defaultProducts);
    }
    // Default: every product in the active category.
    return new Set(
      (productsByCategory[defaultCategory] ?? []).map(p => p.productPathRel)
    );
  });
  const [estimate, setEstimate] = useState<DryRunResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const products = productsByCategory[category] ?? [];
  const visibleProducts = useMemo(
    () => (showOnlyMissing ? products.filter(p => !p.hasExtraction) : products),
    [products, showOnlyMissing]
  );

  // When the category changes, default to "all visible products selected" for
  // ergonomics — submitting a whole category is the dominant flow.
  useEffect(() => {
    setSelected(new Set(products.map(p => p.productPathRel)));
    setEstimate(null);
    setError(null);
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(rel: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    setEstimate(null);
  }

  function selectAll() {
    setSelected(new Set(visibleProducts.map(p => p.productPathRel)));
    setEstimate(null);
  }

  function selectNone() {
    setSelected(new Set());
    setEstimate(null);
  }

  async function callApi(dryRun: boolean) {
    setError(null);
    const productList = Array.from(selected);
    if (productList.length === 0) {
      setError("select at least one product");
      return null;
    }
    const res = await fetch("/api/pipeline/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category,
        products: productList,
        schema_version: schemaVersion,
        dryRun,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error ?? `request failed: ${res.status}`);
      return null;
    }
    return data;
  }

  async function onEstimate() {
    setEstimating(true);
    try {
      const data = await callApi(true);
      if (data) setEstimate(data as DryRunResult);
    } finally {
      setEstimating(false);
    }
  }

  async function onSubmit() {
    if (!estimate) {
      // Force an estimate first.
      await onEstimate();
      return;
    }
    if (estimate.costEstimateUsd > maxRunUsd) {
      setError(
        `estimate ${fmtUsd(estimate.costEstimateUsd)} exceeds cap ${fmtUsd(
          maxRunUsd
        )}`
      );
      return;
    }
    if (
      !confirm(
        `Submit ${estimate.productCount} product${
          estimate.productCount === 1 ? "" : "s"
        } via Anthropic Batch?\nEstimate: ${fmtUsd(estimate.costEstimateUsd)}`
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const data = await callApi(false);
      if (data && data.runId) {
        router.push(`/pipeline/runs/${data.runId}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const overCap = !!estimate && estimate.costEstimateUsd > maxRunUsd;
  const submitDisabled =
    submitting ||
    selected.size === 0 ||
    (estimate !== null && overCap);

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="panel-title font-bold">Category</div>
        <div className="flex flex-wrap gap-2">
          {categories.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded text-sm border ${
                category === c
                  ? "bg-white/10 text-white border-white/30"
                  : "text-white/60 border-white/10 hover:text-white hover:bg-white/5"
              }`}
            >
              {c}{" "}
              <span className="text-white/40 ml-1 text-[11px]">
                {productsByCategory[c]?.length ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-white/40 mt-3 font-mono">
          schema version: {schemaVersion}{" "}
          <span className="text-white/30">
            (W3 will add real version selection)
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="flex items-baseline justify-between mb-3">
          <div className="panel-title mb-0 font-bold">Products</div>
          <div className="text-[11px] text-white/40">
            {selected.size} of {products.length} selected
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-3 text-[12px]">
          <button
            type="button"
            onClick={selectAll}
            className="px-2 py-0.5 rounded text-white/70 hover:text-white hover:bg-white/5 border border-white/10"
          >
            select all
          </button>
          <button
            type="button"
            onClick={selectNone}
            className="px-2 py-0.5 rounded text-white/70 hover:text-white hover:bg-white/5 border border-white/10"
          >
            clear
          </button>
          <label className="inline-flex items-center gap-1.5 text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyMissing}
              onChange={e => setShowOnlyMissing(e.target.checked)}
            />
            only show products without extraction.json
          </label>
        </div>
        {visibleProducts.length === 0 ? (
          <div className="text-sm text-white/50 italic">
            no products match the current filter
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[700px]">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>Slug</th>
                  <th>Line</th>
                  <th>Path</th>
                  <th>extraction.json</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map(p => {
                  const checked = selected.has(p.productPathRel);
                  return (
                    <tr
                      key={p.productPathRel}
                      className="hover:bg-white/[0.04] cursor-pointer"
                      onClick={() => toggle(p.productPathRel)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(p.productPathRel)}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>
                      <td className="font-medium">{p.slug}</td>
                      <td className="text-white/70">{p.line}</td>
                      <td className="text-[11px] text-white/50 font-mono">
                        {p.productPathRel}
                      </td>
                      <td>
                        <span
                          className={
                            p.hasExtraction ? "pill pill-on" : "pill pill-off"
                          }
                        >
                          {p.hasExtraction ? "exists" : "missing"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title font-bold">Cost estimate</div>
        {!estimate ? (
          <div className="text-sm text-white/50">
            click <span className="text-white">Estimate cost</span> to compute
            an upper-bound USD figure before submitting.
          </div>
        ) : (
          <dl className="kv">
            <dt>products</dt>
            <dd>{estimate.productCount}</dd>
            <dt>cold cache (1st call)</dt>
            <dd>{fmtUsd(estimate.coldUsd)}</dd>
            <dt>warm cache (each subsequent)</dt>
            <dd>{fmtUsd(estimate.warmUsdEach)}</dd>
            <dt>total estimate</dt>
            <dd className={overCap ? "text-rose-300" : "text-emerald-300"}>
              {fmtUsd(estimate.costEstimateUsd)}
            </dd>
            <dt>max run cap</dt>
            <dd>{fmtUsd(maxRunUsd)}</dd>
          </dl>
        )}
        {overCap && (
          <div className="mt-3 text-[12px] text-rose-300">
            Estimate exceeds MAX_RUN_USD. Reduce the product set or raise the
            cap in <code className="font-mono">.env</code> before submitting.
          </div>
        )}
      </section>

      {error && (
        <div className="panel border-rose-500/30 bg-rose-500/5 text-rose-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onEstimate}
          disabled={estimating || submitting || selected.size === 0}
          className="px-4 py-2 rounded bg-white/10 hover:bg-white/15 text-sm disabled:opacity-40"
        >
          {estimating ? "estimating…" : "Estimate cost"}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          className="px-4 py-2 rounded bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 text-sm disabled:opacity-40"
        >
          {submitting ? "submitting…" : "Submit batch"}
        </button>
      </div>
    </div>
  );
}
