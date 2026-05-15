import Link from "next/link";
import { listPortfolio, type ProductEntry, type LineSource } from "@/lib/portfolio";
import { formatBytes } from "@/lib/sources";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  server: "Servers",
  chassis: "Chassis",
  storage: "Storage",
  networking: "Networking",
  hci: "HCI"
};

function ProductLink({
  href,
  label,
  count,
  enabled
}: {
  href: string;
  label: string;
  count?: number;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center text-[11px] text-white/25 px-2 py-0.5 rounded border border-white/5 cursor-not-allowed">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center text-[11px] text-white/80 hover:text-white px-2 py-0.5 rounded border border-white/15 hover:border-white/30 bg-white/5 hover:bg-white/10 no-underline"
    >
      {label}
      {count != null && <span className="ml-1 text-white/40">{count}</span>}
    </Link>
  );
}

function LineDocs({
  sources,
  anchorSlug
}: {
  sources: LineSource[];
  anchorSlug: string | null;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="mb-2 rounded border border-sky-500/20 bg-sky-500/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-sky-300/70 mb-1">Line docs</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {sources.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5 text-[11px]">
            <span className="font-mono text-white/80">{s.name}</span>
            <span className="text-white/30">{formatBytes(s.size)}</span>
            {anchorSlug ? (
              <>
                <a
                  href={`/products/${anchorSlug}/raw/__/source/${encodeURIComponent(s.name)}`}
                  target="_blank"
                  rel="noopener"
                  className="text-white/70 hover:text-white px-1.5 py-0.5 rounded border border-white/15 hover:border-white/30 bg-white/5 hover:bg-white/10 no-underline"
                >
                  pdf
                </a>
                {s.parsed_name && (
                  <Link
                    href={`/products/${anchorSlug}/source/__/source/${encodeURIComponent(s.parsed_name)}`}
                    className="text-white/70 hover:text-white px-1.5 py-0.5 rounded border border-white/15 hover:border-white/30 bg-white/5 hover:bg-white/10 no-underline"
                  >
                    parsed
                  </Link>
                )}
              </>
            ) : (
              <span className="text-white/30">no anchor</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductRow({ p }: { p: ProductEntry }) {
  return (
    <tr className="hover:bg-white/[0.04]">
      <td className="font-mono text-[12px] text-white/80">{p.slug}</td>
      <td className="text-[12px] text-white/70">{p.model ?? <span className="text-white/30">—</span>}</td>
      <td>
        <div className="flex flex-wrap gap-1">
          <ProductLink
            href={`/products/${p.slug}/raw`}
            label="raw"
            count={p.pdf_count}
            enabled={p.pdf_count > 0}
          />
          <ProductLink
            href={`/products/${p.slug}/parsed`}
            label="parsed"
            count={p.md_count}
            enabled={p.md_count > 0}
          />
          <ProductLink
            href={`/products/${p.slug}`}
            label="extraction"
            enabled={p.has_extraction}
          />
        </div>
      </td>
    </tr>
  );
}

export default function HomePage() {
  const groups = listPortfolio();
  const totalProducts = groups.reduce((acc, g) => acc + g.product_count, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Product portfolio</h1>
        <p className="text-sm text-white/50 mt-1">
          {totalProducts} product{totalProducts === 1 ? "" : "s"} across{" "}
          {groups.length} categor{groups.length === 1 ? "y" : "ies"}. Each row links to the raw
          source PDFs, the parsed markdown sidecars, and the structured extraction — when those
          artifacts exist.
        </p>
      </div>

      {groups.map((g) => (
        <section key={g.category}>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="text-sm uppercase tracking-wider text-white/60">
              {CATEGORY_LABEL[g.category] ?? g.category}
            </h2>
            <span className="text-[11px] text-white/40">
              {g.product_count} product{g.product_count === 1 ? "" : "s"} ·{" "}
              {g.product_lines.length} line{g.product_lines.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="space-y-4">
            {g.product_lines.map((line) => (
              <div key={line.product_line} className="panel">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium">{line.product_line_name}</div>
                    <div className="text-[11px] text-white/40 font-mono">
                      {g.category}/{line.vendor}/{line.product_line}
                    </div>
                  </div>
                  <div className="text-[11px] text-white/40">
                    {line.products.length} product{line.products.length === 1 ? "" : "s"}
                  </div>
                </div>
                <LineDocs sources={line.line_sources} anchorSlug={line.link_anchor_slug} />
                {line.products.length === 0 ? (
                  <div className="text-[12px] text-white/40 italic">no product directories yet</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Slug</th>
                        <th>Model</th>
                        <th>Artifacts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {line.products.map((p) => (
                        <ProductRow key={`${p.category}-${p.product_line}-${p.slug}`} p={p} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {groups.length === 0 && (
        <div className="panel text-sm text-white/60">
          No product directories found under <code className="font-mono">{"DATA_ROOT/{category}/{vendor}/"}</code>.
          Set <code className="font-mono">DATA_ROOT</code> in <code className="font-mono">.env.local</code> to point at your data.
        </div>
      )}
    </div>
  );
}
