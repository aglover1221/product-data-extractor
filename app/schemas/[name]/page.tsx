import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSchema, isFieldTable, type SchemaSection, type SchemaTable } from "@/lib/schema-md";

export const dynamic = "force-dynamic";

function RequiredChip({ value }: { value: string }) {
  const v = (value || "").toLowerCase().trim();
  if (!v) return <span className="text-white/40">—</span>;
  if (v === "yes")
    return <span className="pill bg-emerald-500/15 text-emerald-300">required</span>;
  if (v.startsWith("yes when") || v === "recommended")
    return <span className="pill bg-sky-500/15 text-sky-300">{v}</span>;
  if (v === "optional") return <span className="pill pill-off">optional</span>;
  return <span className="pill pill-off">{v}</span>;
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <span>{children}</span>,
        a: ({ href, children }) => (
          <a href={href as string} className="text-blue-300/80">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="px-1 rounded bg-white/5 font-mono text-[11px]">{children}</code>
        )
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function FieldTable({ table }: { table: SchemaTable }) {
  const findIdx = (label: string) =>
    table.headers.findIndex((h) => h.toLowerCase().trim() === label);
  const fieldIdx = findIdx("field");
  const typeIdx = findIdx("type");
  const requiredIdx = findIdx("required");
  const extraIdxs = table.headers
    .map((_, i) => i)
    .filter((i) => i !== fieldIdx && i !== typeIdx && i !== requiredIdx);

  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[700px]">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Required</th>
            {extraIdxs.map((i) => (
              <th key={i}>{table.headers[i]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => {
            const name = (row[fieldIdx] || "").replace(/^`|`$/g, "").trim();
            const typ = (row[typeIdx] || "").replace(/^`|`$/g, "").trim();
            const req = row[requiredIdx] || "";
            return (
              <tr key={ri}>
                <td className="font-mono text-[12px] whitespace-nowrap">{name}</td>
                <td className="font-mono text-[11px] text-amber-200/80 whitespace-nowrap">
                  {typ || "—"}
                </td>
                <td>
                  <RequiredChip value={req} />
                </td>
                {extraIdxs.map((i) => (
                  <td key={i} className="text-[12px] text-white/75 max-w-[420px]">
                    <InlineMarkdown text={row[i] || ""} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fieldTableCount(s: SchemaSection): number {
  return s.tables.filter(isFieldTable).reduce((acc, t) => acc + t.rows.length, 0);
}

export default function SchemaDetailPage({ params }: { params: { name: string } }) {
  const doc = getSchema(params.name);
  if (!doc) notFound();

  const fieldSections = doc.sections.filter((s) => fieldTableCount(s) > 0);
  const totalFields = fieldSections.reduce((acc, s) => acc + fieldTableCount(s), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/schemas" className="text-[12px] text-white/50">
          ← schemas
        </Link>
        <div className="text-[11px] uppercase tracking-wider text-white/40 mt-2">
          schema · {doc.is_overlay ? "overlay" : "base"}
        </div>
        <h1 className="text-2xl font-semibold mt-1">{doc.fm.name ?? doc.name}</h1>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          {doc.name}.md · {totalFields} field{totalFields === 1 ? "" : "s"}
          {doc.fm.last_updated && <> · last updated {doc.fm.last_updated}</>}
          {doc.fm.parent && <> · parent {doc.fm.parent}</>}
          {doc.fm.applies_when && <> · applies when {doc.fm.applies_when}</>}
        </div>
        {doc.fm.description && (
          <p className="text-sm text-white/70 mt-2">{doc.fm.description}</p>
        )}
      </div>

      {fieldSections.length === 0 && (
        <div className="panel text-sm text-white/60">No field tables found in this schema.</div>
      )}

      {fieldSections.map((s, si) => (
        <section key={si} className="panel">
          <div className="flex items-baseline justify-between mb-3 gap-3">
            <div
              className="text-sm font-medium"
              style={{ paddingLeft: `${(s.level - 1) * 8}px` }}
            >
              {s.heading}
            </div>
            <div className="text-[11px] text-white/40">
              {fieldTableCount(s)} field{fieldTableCount(s) === 1 ? "" : "s"}
            </div>
          </div>
          {s.tables.filter(isFieldTable).map((t, ti) => (
            <FieldTable key={ti} table={t} />
          ))}
        </section>
      ))}
    </div>
  );
}
