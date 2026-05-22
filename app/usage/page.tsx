/**
 * /usage — cost & cache dashboard.
 *
 * Aggregates over `extraction_runs`, `extraction_results`, and `spotfix_runs`
 * via lib/usage.ts. Server component — no client state, no charting lib.
 * Sparkline is an inline SVG; tables follow the same .data-table styling as
 * /pipeline/runs.
 */
import Link from "next/link";
import { ensureStudioSchema } from "@/lib/db/client";
import {
  getHeadline,
  getDailySpend,
  getTopProducts,
  getSchemaRollup,
  getCacheEfficiency,
  getEstimateDrift,
  type DailySpendPoint,
} from "@/lib/usage";

export const dynamic = "force-dynamic";

// ----------------------------------------------------------------------------
// Formatting helpers (mirrored from /pipeline/runs for consistency)
// ----------------------------------------------------------------------------

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10) return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
  if (n === 0) return "$0";
  return `$${n.toFixed(6)}`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtSignedUsd(n: number): string {
  const s = fmtUsd(Math.abs(n));
  if (n > 0) return `+${s}`;
  if (n < 0) return `-${s}`;
  return s;
}

function fmtDay(iso: string): string {
  // iso = YYYY-MM-DD
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ----------------------------------------------------------------------------
// Inline SVG sparkline (no chart library)
// ----------------------------------------------------------------------------

interface SparklineProps {
  points: DailySpendPoint[];
  width?: number;
  height?: number;
}

function Sparkline({ points, width = 560, height = 80 }: SparklineProps) {
  if (points.length === 0) return null;
  const values = points.map((p) => p.totalUsd);
  const max = Math.max(...values, 0);
  const padX = 4;
  const padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;

  const yFor = (v: number) => {
    if (max === 0) return padY + innerH;
    return padY + innerH - (v / max) * innerH;
  };

  const path = points
    .map((p, i) => {
      const x = padX + i * step;
      const y = yFor(p.totalUsd);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const areaPath = `${path} L${(padX + (points.length - 1) * step).toFixed(2)},${(padY + innerH).toFixed(2)} L${padX.toFixed(2)},${(padY + innerH).toFixed(2)} Z`;

  const lastIdx = points.length - 1;
  const lastX = padX + lastIdx * step;
  const lastY = yFor(points[lastIdx]!.totalUsd);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Spend sparkline over ${points.length} days, peak ${fmtUsd(max)}`}
      className="block"
    >
      <path d={areaPath} fill="rgb(16 185 129 / 0.12)" />
      <path
        d={path}
        fill="none"
        stroke="rgb(16 185 129)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill="rgb(16 185 129)" />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function UsagePage() {
  ensureStudioSchema();

  const headline = getHeadline(30);
  const daily = getDailySpend(30);
  const topProducts = getTopProducts(10);
  const schemas = getSchemaRollup();
  const cache = getCacheEfficiency();
  const drift = getEstimateDrift(20);

  const empty = headline.runsAllTime === 0;

  // Largest absolute drift drives the histogram bar scale.
  const maxAbsDelta = drift.reduce(
    (m, d) => Math.max(m, Math.abs(d.deltaUsd)),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Usage</h1>
          <p className="text-sm text-white/50 mt-1">
            Spend and cache efficiency over the trailing {headline.windowDays}{" "}
            days. All extraction + spotfix runs in the studio DB.
          </p>
        </div>
        <a
          href="/api/usage/export"
          className="px-3 py-1.5 rounded bg-white/10 text-white/80 hover:bg-white/15 text-sm"
          data-testid="usage-export-csv"
        >
          Export CSV ↓
        </a>
      </div>

      {empty ? (
        <div className="panel text-sm text-white/60">
          No extraction runs in the studio DB yet. Submit one from{" "}
          <Link href="/pipeline/extract">/pipeline/extract</Link>, then refresh.
        </div>
      ) : null}

      {/* Headline strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Headline
          label={`Total spend (last ${headline.windowDays}d)`}
          primary={fmtUsd(headline.totalSpendUsd)}
          secondary={`${fmtInt(headline.runsLast30d)} run${headline.runsLast30d === 1 ? "" : "s"}`}
        />
        <Headline
          label="Extraction vs spotfix"
          primary={fmtUsd(headline.extractionUsd)}
          secondary={`+ ${fmtUsd(headline.spotfixUsd)} spotfix`}
        />
        <Headline
          label="Cache hit rate (input + cache tokens)"
          primary={fmtPct(cache.hitRate)}
          secondary={`${fmtInt(cache.cacheReadTokens)} read / ${fmtInt(
            cache.inputTokens + cache.cacheReadTokens + cache.cacheCreationTokens
          )} total`}
        />
        <Headline
          label="Results recorded (all time)"
          primary={fmtInt(headline.resultsAllTime)}
          secondary={`${fmtInt(headline.runsAllTime)} runs`}
        />
      </div>

      {/* Daily sparkline + chart */}
      <section className="panel">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="panel-title !mb-0 font-bold">Daily spend</h2>
          <div className="text-[11px] text-white/40 font-mono">
            {daily[0]?.day} → {daily.at(-1)?.day}
          </div>
        </div>
        <Sparkline points={daily} />
        <div className="mt-3 grid grid-cols-3 gap-3 text-[11px] font-mono text-white/60">
          <div>
            <div className="text-white/40">Peak day</div>
            <div className="text-white/90">
              {(() => {
                const peak = daily.reduce(
                  (p, c) => (c.totalUsd > p.totalUsd ? c : p),
                  daily[0] ?? {
                    day: "—",
                    totalUsd: 0,
                    extractionUsd: 0,
                    spotfixUsd: 0,
                    runCount: 0,
                  }
                );
                return `${peak.day === "—" ? "—" : fmtDay(peak.day)} · ${fmtUsd(peak.totalUsd)}`;
              })()}
            </div>
          </div>
          <div>
            <div className="text-white/40">Avg / day</div>
            <div className="text-white/90">
              {fmtUsd(
                daily.reduce((s, d) => s + d.totalUsd, 0) /
                  Math.max(daily.length, 1)
              )}
            </div>
          </div>
          <div>
            <div className="text-white/40">Days with spend</div>
            <div className="text-white/90">
              {daily.filter((d) => d.totalUsd > 0).length} / {daily.length}
            </div>
          </div>
        </div>
      </section>

      {/* Two-column: top products + per-schema */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="panel">
          <h2 className="panel-title font-bold">Top products by cost</h2>
          {topProducts.length === 0 ? (
            <p className="text-sm text-white/40">No completed results yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Runs</th>
                    <th className="text-right">In tok</th>
                    <th className="text-right">Out tok</th>
                    <th className="text-right">Cache hit</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => {
                    const totalIn =
                      p.inputTokens + p.cacheReadTokens + p.cacheCreationTokens;
                    const hit = totalIn === 0 ? 0 : p.cacheReadTokens / totalIn;
                    return (
                      <tr
                        key={p.productSlug}
                        className="hover:bg-white/[0.04]"
                      >
                        <td className="max-w-[260px] truncate" title={p.productSlug}>
                          <Link href={`/products/${encodeURIComponent(p.productSlug)}`}>
                            {p.productSlug}
                          </Link>
                        </td>
                        <td className="text-right">{p.resultCount}</td>
                        <td className="text-right">{fmtInt(p.inputTokens)}</td>
                        <td className="text-right">{fmtInt(p.outputTokens)}</td>
                        <td className="text-right">{fmtPct(hit, 0)}</td>
                        <td className="text-right">{fmtUsd(p.costUsd)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-white/40 mt-2">
            Cost recomputed from per-result tokens via <code>calcCost</code>{" "}
            (Opus 4.7 pricing, batch flag inferred from <code>batch_id</code>).
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title font-bold">Per-schema spend</h2>
          {schemas.length === 0 ? (
            <p className="text-sm text-white/40">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Schema</th>
                    <th className="text-right">Runs</th>
                    <th className="text-right">Products</th>
                    <th className="text-right">Estimate</th>
                    <th className="text-right">Actual</th>
                    <th className="text-right">Drift</th>
                  </tr>
                </thead>
                <tbody>
                  {schemas.map((s) => (
                    <tr key={s.schemaName} className="hover:bg-white/[0.04]">
                      <td>{s.schemaName}</td>
                      <td className="text-right">{s.runCount}</td>
                      <td className="text-right">{s.productCount}</td>
                      <td className="text-right">{fmtUsd(s.estimateUsd)}</td>
                      <td className="text-right">{fmtUsd(s.actualUsd)}</td>
                      <td
                        className={`text-right ${
                          s.driftUsd === null
                            ? "text-white/30"
                            : s.driftUsd > 0
                              ? "text-rose-300"
                              : s.driftUsd < 0
                                ? "text-emerald-300"
                                : "text-white/60"
                        }`}
                      >
                        {s.driftUsd === null
                          ? "—"
                          : fmtSignedUsd(s.driftUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-white/40 mt-2">
            Drift = actual − estimate. Red = under-estimated (cost more than we
            said it would).
          </p>
        </section>
      </div>

      {/* Estimator drift list */}
      <section className="panel">
        <h2 className="panel-title font-bold">Estimator drift, recent runs</h2>
        {drift.length === 0 ? (
          <p className="text-sm text-white/40">
            No completed runs with both estimate and actual recorded.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[800px]">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Schema</th>
                  <th className="text-right">Estimate</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Δ</th>
                  <th className="text-right">Δ%</th>
                  <th>Bar</th>
                </tr>
              </thead>
              <tbody>
                {drift.map((d) => {
                  const widthPct =
                    maxAbsDelta === 0
                      ? 0
                      : (Math.abs(d.deltaUsd) / maxAbsDelta) * 100;
                  const positive = d.deltaUsd >= 0;
                  return (
                    <tr key={d.runId} className="hover:bg-white/[0.04]">
                      <td>
                        <Link
                          href={`/pipeline/runs/${d.runId}`}
                          className="font-mono"
                        >
                          #{d.runId}
                        </Link>
                      </td>
                      <td>{d.schemaName}</td>
                      <td className="text-right">{fmtUsd(d.estimateUsd)}</td>
                      <td className="text-right">{fmtUsd(d.actualUsd)}</td>
                      <td
                        className={`text-right ${positive ? "text-rose-300" : "text-emerald-300"}`}
                      >
                        {fmtSignedUsd(d.deltaUsd)}
                      </td>
                      <td
                        className={`text-right ${positive ? "text-rose-300/80" : "text-emerald-300/80"}`}
                      >
                        {fmtPct(d.ratio, 0)}
                      </td>
                      <td>
                        <div className="h-2 w-32 bg-white/5 rounded overflow-hidden">
                          <div
                            className={`h-full ${positive ? "bg-rose-400/60" : "bg-emerald-400/60"}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Headline({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="panel">
      <div className="text-[11px] uppercase tracking-wider text-white/40">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1 font-mono tabular-nums">
        {primary}
      </div>
      <div className="text-[11px] text-white/50 mt-1 font-mono">{secondary}</div>
    </div>
  );
}
