import type { Evidence } from "@/lib/extractions";
import { unwrap } from "@/lib/extractions";
import type { Annotation } from "@/lib/annotations";
import AnnotationButton from "@/app/_components/AnnotationButton";

export function evidenceTitle(ev: Evidence | null | undefined): string | undefined {
  if (!ev) return undefined;
  if (ev.source === "source-silent") {
    return `source-silent${ev.quote ? `: ${ev.quote}` : ""}`;
  }
  const parts: string[] = [];
  parts.push(`Source: ${ev.source}`);
  if (ev.anchor) parts.push(`@ ${ev.anchor}`);
  if (ev.page != null) parts.push(`p.${ev.page}`);
  if (ev.confidence != null) parts.push(`conf=${ev.confidence.toFixed(2)}`);
  if (ev.derivation) parts.push(`derived: ${ev.derivation}`);
  if (ev.quote) parts.push(`\n"${ev.quote}"`);
  return parts.join("  ");
}

export function ConfDot({ ev }: { ev: Evidence | null | undefined }) {
  if (!ev) return null;
  if (ev.source === "source-silent") {
    return (
      <span
        className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-white/20 align-middle"
        title="source-silent"
      />
    );
  }
  if (ev.derived || ev.derivation) {
    const c = ev.confidence ?? 1;
    const cls =
      c >= 0.9
        ? "bg-sky-400"
        : c >= 0.8
        ? "bg-sky-400/60"
        : c >= 0.65
        ? "bg-amber-400"
        : "bg-rose-400";
    return (
      <span
        className={`ml-1 inline-block w-1.5 h-1.5 rounded-full ${cls} align-middle ring-1 ring-white/20`}
        title={`derived · confidence ${c.toFixed(2)}`}
      />
    );
  }
  const c = ev.confidence ?? 1;
  const cls =
    c >= 0.9
      ? "bg-emerald-400"
      : c >= 0.8
      ? "bg-emerald-400/60"
      : c >= 0.65
      ? "bg-amber-400"
      : "bg-rose-400";
  return (
    <span
      className={`ml-1 inline-block w-1.5 h-1.5 rounded-full ${cls} align-middle`}
      title={`confidence ${c.toFixed(2)}`}
    />
  );
}

export function fmtVal(v: any): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function Field({
  label,
  field,
  format,
  slug,
  annotations,
  fieldPath
}: {
  label: string;
  field: any;
  format?: (v: any) => string;
  slug?: string;
  annotations?: Annotation[];
  fieldPath?: string;
}) {
  const v = unwrap(field);
  const ev: Evidence | null =
    field && typeof field === "object" && "evidence" in field ? field.evidence : null;
  const display = v == null ? "—" : format ? format(v) : fmtVal(v);
  const path = fieldPath ?? label;
  const fieldAnns = slug && annotations
    ? annotations.filter((a) => a.field_path === path)
    : [];
  return (
    <>
      <dt>{label}</dt>
      <dd title={evidenceTitle(ev)} className={v == null ? "text-white/40" : ""}>
        {display}
        <ConfDot ev={ev} />
        {slug && annotations && (
          <AnnotationButton slug={slug} fieldPath={path} annotations={fieldAnns} />
        )}
      </dd>
    </>
  );
}

export function makeField(slug: string, annotations: Annotation[]) {
  return function BoundField(props: {
    label: string;
    field: any;
    format?: (v: any) => string;
    fieldPath?: string;
  }) {
    return <Field {...props} slug={slug} annotations={annotations} />;
  };
}

export function AnnotationHeader({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <th className="w-8"></th>;
}

export function RowAnnotationCell({
  slug,
  annotations,
  arrayName,
  index
}: {
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
  index: number;
}) {
  if (!slug || !annotations || !arrayName) return null;
  const path = `${arrayName}[${index}]`;
  const fieldAnns = annotations.filter((a) => a.field_path === path);
  return (
    <td className="w-8 align-middle">
      <AnnotationButton slug={slug} fieldPath={path} annotations={fieldAnns} />
    </td>
  );
}

export function Section({
  title,
  count,
  hint,
  children
}: {
  title: string;
  count?: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <div className="panel-title mb-0">{title}</div>
          {hint && <div className="text-[11px] text-white/40">{hint}</div>}
        </div>
        {count != null && <div className="text-[11px] text-white/40">{count} rows</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ label = "none" }: { label?: string }) {
  return <div className="text-sm text-white/40 italic">{label}</div>;
}
