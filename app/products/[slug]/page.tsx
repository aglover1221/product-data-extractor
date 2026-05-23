import Link from "next/link";
import { notFound } from "next/navigation";
import { getExtraction, unwrap, type Extraction, type Evidence } from "@/lib/extractions";
import { readAnnotations, type Annotation } from "@/lib/annotations";
import { getProductStageStatus } from "@/lib/stages";
import AnnotationButton from "@/app/_components/AnnotationButton";
import StorageView from "./_storage-view";
import NetworkingView from "./_networking-view";
import HciView from "./_hci-view";
import { PipelineStrip, SourcesPanel, VerifyPanel } from "./_pipeline-strip";
import ReExtractButton from "@/app/_components/ReExtractButton";

export const dynamic = "force-dynamic";

// ---------- helpers ----------

// Extractions are inconsistent: some array fields land as raw arrays, others as
// {value, evidence} wrappers. Always pull the array regardless of shape.
function asRows(field: any): any[] {
  if (Array.isArray(field)) return field;
  if (field && Array.isArray(field.value)) return field.value;
  return [];
}

function evidenceTitle(ev: Evidence | null | undefined): string | undefined {
  if (!ev) return undefined;
  if (ev.source === "source-silent") {
    return `source-silent${ev.quote ? `: ${ev.quote}` : ""}`;
  }
  const parts: string[] = [];
  parts.push(`Source: ${ev.source}`);
  if (ev.anchor) parts.push(`@ ${ev.anchor}`);
  if (ev.page != null) parts.push(`p.${ev.page}`);
  if (ev.confidence != null) parts.push(`conf=${ev.confidence.toFixed(2)}`);
  if (ev.quote) parts.push(`\n"${ev.quote}"`);
  return parts.join("  ");
}

function ConfDot({ ev }: { ev: Evidence | null | undefined }) {
  if (!ev) return null;
  if (ev.source === "source-silent") {
    return (
      <span
        className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-white/20 align-middle"
        title="source-silent"
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

function fmtVal(v: any): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function RowAnnotationCell({
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

function AnnotationHeader({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <th className="w-8"></th>;
}

function makeField(slug: string, annotations: Annotation[]) {
  return function Field({
    label,
    field,
    format,
    fieldPath
  }: {
    label: string;
    field: any;
    format?: (v: any) => string;
    fieldPath?: string;
  }) {
    const v = unwrap(field);
    const ev: Evidence | null =
      field && typeof field === "object" && "evidence" in field ? field.evidence : null;
    const display = v == null ? "—" : format ? format(v) : fmtVal(v);
    const path = fieldPath ?? label;
    const fieldAnns = annotations.filter((a) => a.field_path === path);
    return (
      <>
        <dt>{label}</dt>
        <dd title={evidenceTitle(ev)} className={v == null ? "text-white/40" : ""}>
          {display}
          <ConfDot ev={ev} />
          <AnnotationButton slug={slug} fieldPath={path} annotations={fieldAnns} />
        </dd>
      </>
    );
  };
}

function Section({
  title,
  count,
  children
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="flex items-baseline justify-between mb-3">
        <div className="panel-title mb-0">{title}</div>
        {count != null && <div className="text-[11px] text-white/40">{count} rows</div>}
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return <div className="text-sm text-white/40 italic">none</div>;
}

// ---------- subarray renderers ----------

function CpuSkusTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[900px]">
        <thead>
          <tr>
            <th>Model</th>
            <th className="!text-center">Family</th>
            <th className="!text-center">Clock</th>
            <th className="!text-center">Cache</th>
            <th className="!text-center">Cores</th>
            <th className="!text-center">Threads</th>
            <th className="!text-center">Mem MT/s</th>
            <th className="!text-center">TDP</th>
            <th className="!text-center">DLC</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">{r.model}</td>
              <td className="text-white/70 !text-center">{r.family}</td>
              <td className="!text-center">{r.clock_ghz ? `${r.clock_ghz} GHz` : "—"}</td>
              <td className="!text-center">{r.cache_mb ? `${r.cache_mb} MB` : "—"}</td>
              <td className="!text-center">{r.cores ?? "—"}</td>
              <td className="!text-center">{r.threads ?? "—"}</td>
              <td className="!text-center">{r.memory_speed_mt_s ?? "—"}</td>
              <td className="!text-center">{r.tdp_w ? `${r.tdp_w} W` : "—"}</td>
              <td className="!text-center">
                <span className={r.requires_dlc ? "pill pill-on" : "pill pill-off"}>
                  {r.requires_dlc ? "req" : "no"}
                </span>
                <ConfDot ev={r.evidence} />
              </td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DimmsTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[900px]">
        <thead>
          <tr>
            <th>Type</th>
            <th className="!text-center">Family</th>
            <th className="!text-center">1DPC</th>
            <th className="!text-center">2DPC</th>
            <th className="!text-center">Capacity</th>
            <th className="!text-center">Ranks</th>
            <th className="!text-center">Width</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">{r.dimm_type}</td>
              <td className="text-white/70 !text-center">{r.family}</td>
              <td className="!text-center">{r.speed_mt_s_1dpc ? `${r.speed_mt_s_1dpc} MT/s` : "—"}</td>
              <td className="!text-center">{r.speed_mt_s_2dpc ? `${r.speed_mt_s_2dpc} MT/s` : "—"}</td>
              <td className="!text-center">{r.capacity_gb ? `${r.capacity_gb} GB` : "—"}</td>
              <td className="!text-center">{r.ranks ?? "—"}</td>
              <td className="!text-center">{r.width ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriveConfigsTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Description</th>
            <th className="!text-center">Count</th>
            <th className="!text-center">Form factor</th>
            <th className="!text-center">Protocols</th>
            <th className="!text-center">Rear</th>
            <th className="!text-center">Front-IO</th>
            <th className="!text-center">Max raw</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="max-w-[300px]">{r.description}</td>
              <td className="!text-center">{r.drive_count ?? "—"}</td>
              <td className="!text-center">{r.drive_form_factor ?? "—"}</td>
              <td className="!text-center">
                {Array.isArray(r.drive_protocols)
                  ? r.drive_protocols.map((p: string) => (
                      <span key={p} className="chip mr-1">
                        {p}
                      </span>
                    ))
                  : "—"}
              </td >
              <td className="!text-center">{r.is_rear ? "yes" : "—"}</td>
              <td className="!text-center">{r.is_front_io ? "yes" : "—"}</td>
              <td>
                {r.max_raw_capacity_tb ? `${r.max_raw_capacity_tb.toFixed(0)} TB` : "—"}
              </td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupportedDrivesTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[700px]">
        <thead>
          <tr>
            <th>Form factor</th>
            <th >Type</th>
            <th>Speed</th>
            <th>Class</th>
            <th>Capacities</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td>{r.form_factor}</td>
              <td className="font-medium">{r.drive_type}</td>
              <td>{r.speed ?? "—"}</td>
              <td>{r.drive_class ?? "—"}</td>
              <td>
                {Array.isArray(r.capacities)
                  ? r.capacities.join(" / ")
                  : "—"}
              </td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StorageControllersTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Category</th>
          <th>External</th>
          <th>Notes</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="font-medium">{r.name}</td>
            <td>
              <span className="chip">{r.category}</span>
            </td>
            <td>{r.is_external ? "yes" : "—"}</td>
            <td className="text-white/60 text-[12px]">{r.notes ?? ""}</td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BootDrivesTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Form factor</th>
          <th>Capacities</th>
          <th>Controller</th>
          <th>Redundancy</th>
          <th>Notes</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="font-medium">{r.form_factor}</td>
            <td>{Array.isArray(r.capacities) ? r.capacities.join(" / ") : "—"}</td>
            <td className="text-white/70">{r.controller}</td>
            <td>{r.redundancy ?? "—"}</td>
            <td className="text-white/60 text-[12px]">{r.notes ?? ""}</td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GpuFormFactorTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Form factor</th>
          <th className="!text-center">Max count</th>
          <th className="!text-center">Max W per GPU</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="font-medium">{r.form_factor}</td>
            <td className="!text-center">{r.max_count ?? "—"}</td>
            <td className="!text-center">{r.max_power_w_per_gpu ? `${r.max_power_w_per_gpu} W` : "—"}</td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SupportedGpusTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>GPU</th>
          <th>Vendor</th>
          <th>Form factor</th>
          <th className="!text-center">Power</th>
          <th className="!text-center">Max qty</th>
          <th>PCIe</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="font-medium">{r.gpu}</td>
            <td className="text-white/70">{r.vendor}</td>
            <td>{r.form_factor}</td>
            <td className="!text-center">{r.power_w ? `${r.power_w} W` : "—"}</td>
            <td className="!text-center">{r.max_qty ?? "—"}</td>
            <td>{r.pcie ?? "—"}</td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PcieSlotsTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[900px]">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Processor</th>
            <th>Height</th>
            <th>Length</th>
            <th>Lane</th>
            <th>Gen</th>
            <th>Power</th>
            <th>Always-on</th>
            <th>Active in riser configs</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">{r.slot_name}</td>
              <td className="text-white/70">{r.processor}</td>
              <td>{r.height}</td>
              <td>{r.length}</td>
              <td>{r.lane_width}</td>
              <td>{r.pcie_gen}</td>
              <td>{r.power_class ?? "—"}</td>
              <td>
                <span className={r.is_always_on ? "pill pill-on" : "pill pill-off"}>
                  {r.is_always_on ? "yes" : "no"}
                </span>
              </td>
              <td className="max-w-[280px]">
                {Array.isArray(r.riser_codes) && r.riser_codes.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {r.riser_codes.map((c: string) => (
                      <span key={c} className="chip">
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-white/40">—</span>
                )}
              </td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiserConfigsTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[700px]">
        <thead>
          <tr>
            <th>Config</th>
            <th>Description</th>
            <th className="!text-center">CPUs</th>
            <th className="!text-center">Slots</th>
            <th>Use case</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">{r.config_no}</td>
              <td className="max-w-[420px]">{r.riser_configuration}</td>
              <td className="!text-center">{r.cpus ?? "—"}</td>
              <td className="!text-center">{r.slot_count ?? "—"}</td>
              <td className="text-white/70">{r.use_case ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DpusTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Vendor</th>
          <th className="!text-center">Port speed</th>
          <th className="!text-center">Ports</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="font-medium">{r.model}</td>
            <td className="text-white/70">{r.vendor}</td>
            <td className="!text-center">{r.port_speed ?? "—"}</td>
            <td className="!text-center">{r.port_count ?? "—"}</td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CxlConfigsTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[1100px]">
        <thead>
          <tr>
            <th>Config</th>
            <th>Riser</th>
            <th>Slots</th>
            <th>Native DIMMs</th>
            <th>Native cap</th>
            <th>AICs</th>
            <th>Per-AIC</th>
            <th>CXL cap</th>
            <th>Total system</th>
            <th>At launch</th>
            <th>Notes</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">{r.config_label}</td>
              <td>
                <span className="chip">{r.riser_code}</span>
              </td>
              <td>
                {Array.isArray(r.slots_used) ? (
                  <div className="flex flex-wrap gap-1">
                    {r.slots_used.map((s: string) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="text-white/70">{r.native_dimm_config}</td>
              <td>
                {r.native_dimm_capacity_gb ? `${r.native_dimm_capacity_gb} GB` : "—"}
              </td>
              <td>{r.cxl_aic_count ?? "—"}</td>
              <td className="text-white/70">
                {r.cxl_dimm_count_per_aic && r.cxl_dimm_capacity_gb
                  ? `${r.cxl_dimm_count_per_aic} × ${r.cxl_dimm_capacity_gb} GB`
                  : "—"}
              </td>
              <td>
                {r.cxl_total_capacity_gb ? `${r.cxl_total_capacity_gb} GB` : "—"}
              </td>
              <td className="font-medium">
                {r.total_system_memory_gb
                  ? `${r.total_system_memory_gb} GB (${(r.total_system_memory_gb / 1024).toFixed(1)} TB)`
                  : "—"}
              </td>
              <td>
                <span className={r.available_at_launch ? "pill pill-on" : "pill pill-off"}>
                  {r.available_at_launch ? "yes" : "no"}
                </span>
              </td>
              <td className="text-white/60 text-[12px] max-w-[260px]">{r.notes ?? ""}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PsuOptionsTable({
  rows,
  slug,
  annotations,
  arrayName
}: {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
}) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="!text-left">Output</th>
          <th>Class</th>
          <th>Input</th>
          <th>At launch</th>
          <th>Notes</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="!text-left font-medium">{r.output_w ? `${r.output_w} W` : "—"}</td>
            <td>{r.efficiency_class ?? "—"}</td>
            <td>{r.input ?? "—"}</td>
            <td>{r.available_at_launch ? "yes" : "—"}</td>
            <td className="text-white/60 text-[12px]">{r.notes ?? ""}</td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourcesTable({ rows }: { rows: any[] }) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Title</th>
          <th>Local</th>
          <th>Extraction</th>
          <th>Pages</th>
          <th>Audit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>
              <span className="chip">{r.type}</span>
            </td>
            <td className="max-w-[320px]">{r.title}</td>
            <td className="text-[11px] text-white/60 font-mono">{r.local}</td>
            <td className="text-[11px] text-white/60 font-mono">{r.local_extraction ?? "—"}</td>
            <td className="text-right">{r.pages ?? "—"}</td>
            <td className="text-[11px]">
              <span className="chip">{r.audit_status ?? "unchecked"}</span>{" "}
              <span className="text-white/40">{r.audit_date}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- page ----------

export default function ProductPage({ params }: { params: { slug: string } }) {
  const d = getExtraction(params.slug) as Extraction | null;
  if (!d) notFound();

  const reExtract = (
    <div className="flex justify-end">
      <ReExtractButton
        productSlug={d.slug}
        category={d.category}
        label="Re-extract"
      />
    </div>
  );

  if (d.category === "storage") {
    return (
      <>
        {reExtract}
        <StorageView d={d} />
        <div className="text-center text-[11px] text-white/30 py-4 mt-6">
          Hover any value or table row to see source · anchor · page · confidence · quote.
        </div>
        <div className="text-center">
          <Link href="/" className="text-sm text-white/50">
            ← back to all extractions
          </Link>
        </div>
      </>
    );
  }

  if (d.category === "networking") {
    return (
      <>
        {reExtract}
        <NetworkingView d={d} />
        <div className="text-center text-[11px] text-white/30 py-4 mt-6">
          Hover any value or table row to see source · anchor · page · confidence · quote.
        </div>
        <div className="text-center">
          <Link href="/" className="text-sm text-white/50">
            ← back to all extractions
          </Link>
        </div>
      </>
    );
  }

  if (d.category === "hci") {
    return (
      <>
        {reExtract}
        <HciView d={d} />
        <div className="text-center text-[11px] text-white/30 py-4 mt-6">
          Hover any value or table row to see source · anchor · page · confidence · quote.
        </div>
        <div className="text-center">
          <Link href="/" className="text-sm text-white/50">
            ← back to all extractions
          </Link>
        </div>
      </>
    );
  }

  const annotations = readAnnotations(d.slug).annotations;
  const openAnnotationCount = annotations.filter((a) => a.status === "open").length;
  const Field = makeField(d.slug, annotations);
  const stage = getProductStageStatus(d.slug);
  const serverType = unwrap<string>(d.server_type);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/40">
            {d.vendor} / {d.category} / {d.product_line}
          </div>
          <h1 className="text-2xl font-semibold mt-1">{d.model}</h1>
          <div className="text-[11px] text-white/40 font-mono mt-1">
            /{d.slug} · schema {d.extraction_metadata?.schema_version ?? "—"} · extracted{" "}
            {d.extraction_metadata?.extracted_at ?? "—"} · extractor{" "}
            {d.extraction_metadata?.extractor ?? "—"}
          </div>
        </div>
       <ReExtractButton
           productSlug={d.slug}
          category={d.category}
          label="Re-extract"
        />
      </div>

      <PipelineStrip stage={stage} serverType={serverType} />

      <SourcesPanel sources={stage.sources} />

      <VerifyPanel report={stage.verify} />

      <Section title="Identity">
        <dl className="kv">
          <dt>vendor</dt>
          <dd>{d.vendor}</dd>
          <dt>product line</dt>
          <dd>{d.product_line}</dd>
          <dt>model</dt>
          <dd>{d.model}</dd>
          <dt>slug</dt>
          <dd>{d.slug}</dd>
          <Field label="regulatory_model" field={d.regulatory_model} />
          <Field label="manufacturer" field={d.manufacturer} />
          <Field label="predecessor" field={d.predecessor} />
          <Field label="successor" field={d.successor} />
        </dl>
      </Section>

      <Section title="Type & lifecycle">
        <dl className="kv">
          <Field label="server_type" field={d.server_type} />
          <Field label="generation" field={d.generation} />
          <Field label="status" field={d.status} />
          <Field label="announced_date" field={d.announced_date} />
          <Field label="ga_year" field={d.ga_year} />
          <Field label="ga_month" field={d.ga_month} />
          <Field label="eos_date" field={d.eos_date} />
          <Field label="eosp_date" field={d.eosp_date} />
          <Field label="eol_date" field={d.eol_date} />
        </dl>
      </Section>

      <Section title="Physical">
        <dl className="kv">
          <Field label="form_factor" field={d.form_factor} />
          <Field label="rack_units" field={d.rack_units} />
          <Field label="height_mm" field={d.height_mm} format={(v) => `${v} mm`} />
          <Field label="width_mm" field={d.width_mm} format={(v) => `${v} mm`} />
          <Field label="depth_mm" field={d.depth_mm} format={(v) => `${v} mm`} />
          <Field label="weight_kg" field={d.weight_kg} format={(v) => `${v} kg`} />
        </dl>
      </Section>

      <Section title="Cooling">
        <dl className="kv">
          <Field label="supports_air" field={d.supports_air} />
          <Field label="supports_dlc" field={d.supports_dlc} />
          <Field label="supports_front_io" field={d.supports_front_io} />
          <Field label="fan_count_max" field={d.fan_count_max} />
          <Field label="fan_redundancy" field={d.fan_redundancy} />
          <Field label="fan_direction" field={d.fan_direction} />
        </dl>
      </Section>

      <Section title="CPU envelope">
        <dl className="kv">
          <Field label="socket_count" field={d.socket_count} />
          <Field label="socket_type" field={d.socket_type} />
          <Field label="processor_family" field={d.processor_family} />
          <Field label="memory_channels_per_socket" field={d.memory_channels_per_socket} />
        </dl>
      </Section>

      <Section title="CPU SKUs" count={d.cpu_skus?.length ?? 0}>
        <CpuSkusTable
          rows={d.cpu_skus ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="cpu_skus"
        />
      </Section>

      <Section title="Memory envelope">
        <dl className="kv">
          <Field label="dimm_slots" field={d.dimm_slots} />
          <Field
            label="max_memory_gb"
            field={d.max_memory_gb}
            format={(v) => `${v} GB (${(v / 1024).toFixed(1)} TB)`}
          />
          <Field
            label="max_memory_speed_mt_s_1dpc"
            field={d.max_memory_speed_mt_s_1dpc}
            format={(v) => `${v} MT/s`}
          />
          <Field
            label="max_memory_speed_mt_s_2dpc"
            field={d.max_memory_speed_mt_s_2dpc}
            format={(v) => `${v} MT/s`}
          />
          <Field label="supports_cxl" field={d.supports_cxl} />
          <Field
            label="cxl_max_total_memory_gb"
            field={d.cxl_max_total_memory_gb}
            format={(v) => `${v} GB`}
          />
        </dl>
      </Section>

      <Section title="Supported DIMMs" count={d.supported_dimms?.length ?? 0}>
        <DimmsTable
          rows={d.supported_dimms ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="supported_dimms"
        />
      </Section>

      <Section title="CXL envelope">
        <dl className="kv">
          <Field label="supports_cxl" field={d.supports_cxl} />
          <Field label="cxl_version" field={d.cxl_version} />
          <Field label="cxl_supported_types" field={d.cxl_supported_types} />
          <Field label="cxl_form_factor" field={d.cxl_form_factor} />
          <Field label="cxl_supported_families" field={d.cxl_supported_families} />
          <Field label="cxl_max_devices_total" field={d.cxl_max_devices_total} />
          <Field label="cxl_max_devices_per_cpu" field={d.cxl_max_devices_per_cpu} />
          <Field
            label="cxl_max_total_memory_gb"
            field={d.cxl_max_total_memory_gb}
            format={(v) => `${v} GB (${(v / 1024).toFixed(1)} TB)`}
          />
          <Field
            label="cxl_total_system_memory_gb"
            field={d.cxl_total_system_memory_gb}
            format={(v) => `${v} GB (${(v / 1024).toFixed(1)} TB)`}
          />
          <Field label="cxl_constraints" field={d.cxl_constraints} />
        </dl>
      </Section>

      <Section title="CXL configurations" count={d.cxl_configurations?.length ?? 0}>
        <CxlConfigsTable
          rows={d.cxl_configurations ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="cxl_configurations"
        />
      </Section>

      <Section title="Storage envelope">
        <dl className="kv">
          <Field label="max_drive_count" field={d.max_drive_count} />
          <Field
            label="max_raw_capacity_tb"
            field={d.max_raw_capacity_tb}
            format={(v) => `${Number(v).toFixed(0)} TB`}
          />
        </dl>
      </Section>

      <Section title="Drive configurations" count={d.drive_configurations?.length ?? 0}>
        <DriveConfigsTable
          rows={d.drive_configurations ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="drive_configurations"
        />
      </Section>

      <Section title="Supported drives" count={d.supported_drives?.length ?? 0}>
        <SupportedDrivesTable
          rows={d.supported_drives ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="supported_drives"
        />
      </Section>

      <Section title="Storage controllers" count={d.storage_controllers?.length ?? 0}>
        <StorageControllersTable
          rows={d.storage_controllers ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="storage_controllers"
        />
      </Section>

      <Section title="Boot drives" count={d.boot_drives?.length ?? 0}>
        <BootDrivesTable
          rows={d.boot_drives ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="boot_drives"
        />
      </Section>

      <Section title="GPU envelope">
        <dl className="kv">
          <Field label="supports_gpu" field={d.supports_gpu} />
          <Field label="supports_sxm_gpu" field={d.supports_sxm_gpu} />
          <Field label="supports_oam_gpu" field={d.supports_oam_gpu} />
          <Field label="oam_baseboard_size" field={d.oam_baseboard_size} />
          <Field label="supports_pcie_gpu" field={d.supports_pcie_gpu} />
          <Field label="supports_double_width_gpu" field={d.supports_double_width_gpu} />
          <Field label="pcie_switch_board" field={d.pcie_switch_board} />
          <Field
            label="max_gpu_power_w"
            field={d.max_gpu_power_w}
            format={(v) => `${v} W`}
          />
        </dl>
      </Section>

      <Section title="GPU form-factor support" count={d.gpu_form_factor_support?.length ?? 0}>
        <GpuFormFactorTable
          rows={d.gpu_form_factor_support ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="gpu_form_factor_support"
        />
      </Section>

      <Section title="Supported GPUs" count={d.supported_gpus?.length ?? 0}>
        <SupportedGpusTable
          rows={d.supported_gpus ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="supported_gpus"
        />
      </Section>

      <Section title="PCIe envelope">
        <dl className="kv">
          <Field label="pcie_max_generation" field={d.pcie_max_generation} />
          <Field label="max_pcie_slots" field={d.max_pcie_slots} />
          <Field label="max_rear_pcie_slots" field={d.max_rear_pcie_slots} />
          <Field label="max_front_pcie_slots" field={d.max_front_pcie_slots} />
          <Field label="supports_dpu" field={d.supports_dpu} />
          <Field label="dpu_support_mode" field={d.dpu_support_mode} />
        </dl>
      </Section>

      <Section title="PCIe slot map" count={d.pcie_slots?.length ?? 0}>
        <PcieSlotsTable
          rows={d.pcie_slots ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="pcie_slots"
        />
      </Section>

      <Section title="Riser configs" count={d.riser_configs?.length ?? 0}>
        <RiserConfigsTable
          rows={d.riser_configs ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="riser_configs"
        />
      </Section>

      <Section title="Supported DPUs" count={d.supported_dpus?.length ?? 0}>
        <DpusTable
          rows={d.supported_dpus ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="supported_dpus"
        />
      </Section>

      <Section title="LOM">
        <dl className="kv">
          <Field label="lom_available" field={d.lom_available} />
          <Field label="lom_port_count" field={d.lom_port_count} />
          <Field label="lom_speeds_gbe" field={d.lom_speeds_gbe} />
          <Field label="lom_port_types" field={d.lom_port_types} />
        </dl>
      </Section>

      <Section title="OCP NIC slot">
        <dl className="kv">
          <Field label="ocp_slot_count" field={d.ocp_slot_count} />
          <Field label="ocp_generation" field={d.ocp_generation} />
          <Field label="ocp_form_factor" field={d.ocp_form_factor} />
          <Field label="ocp_pcie_gen" field={d.ocp_pcie_gen} />
          <Field label="ocp_lane_widths" field={d.ocp_lane_widths} />
          <Field label="ocp_max_ports" field={d.ocp_max_ports} />
          <Field
            label="ocp_max_port_speed_gbe"
            field={d.ocp_max_port_speed_gbe}
            format={(v) => `${v} GbE`}
          />
          <Field label="ocp_port_types" field={d.ocp_port_types} />
          <Field
            label="ocp_power_envelope_w"
            field={d.ocp_power_envelope_w}
            format={(v) => `${v} W`}
          />
          <Field label="ocp_mgmt_features" field={d.ocp_mgmt_features} />
          <Field label="ocp_supports_dpu" field={d.ocp_supports_dpu} />
        </dl>
      </Section>

      <Section title="Management">
        <dl className="kv">
          <Field label="mgmt_controller" field={d.mgmt_controller} />
          <Field label="mgmt_port" field={d.mgmt_port} />
        </dl>
      </Section>

      <Section title="Power envelope">
        <dl className="kv">
          <Field label="psu_count_max" field={d.psu_count_max} />
          <Field label="psu_redundancy" field={d.psu_redundancy} />
          <Field
            label="max_psu_output_w"
            field={d.max_psu_output_w}
            format={(v) => `${v} W`}
          />
          <Field label="best_psu_efficiency_class" field={d.best_psu_efficiency_class} />
          <Field label="dc_power_supported" field={d.dc_power_supported} />
        </dl>
      </Section>

      <Section title="PSU options" count={d.psu_options?.length ?? 0}>
        <PsuOptionsTable
          rows={d.psu_options ?? []}
          slug={d.slug}
          annotations={annotations}
          arrayName="psu_options"
        />
      </Section>

      <Section title="Security features" count={asRows(d.security_features).length}>
        {!asRows(d.security_features).length ? (
          <Empty />
        ) : (
          <div className="flex flex-wrap gap-2">
            {asRows(d.security_features).map((s: any, i: number) => {
              const path = `security_features[${i}]`;
              const fieldAnns = annotations.filter((a) => a.field_path === path);
              const label = typeof s === "string" ? s : (s?.value ?? s?.feature ?? s?.tag ?? "?");
              const itemEvidence =
                typeof s === "object" && s?.evidence ? s.evidence : d.security_features?.evidence;
              return (
                <span
                  key={i}
                  className="chip inline-flex items-center"
                  title={evidenceTitle(itemEvidence)}
                >
                  {label}
                  <AnnotationButton slug={d.slug} fieldPath={path} annotations={fieldAnns} />
                </span>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Supported OS" count={asRows(d.supported_os).length}>
        {!asRows(d.supported_os).length ? (
          <Empty />
        ) : (
          <div className="flex flex-wrap gap-2">
            {asRows(d.supported_os).map((o: any, i: number) => {
              const path = `supported_os[${i}]`;
              const fieldAnns = annotations.filter((a) => a.field_path === path);
              return (
                <span
                  key={i}
                  className="chip inline-flex items-center"
                  title={evidenceTitle(o.evidence)}
                >
                  {o.value ?? o.os_name ?? (typeof o === "string" ? o : "?")}
                  <AnnotationButton slug={d.slug} fieldPath={path} annotations={fieldAnns} />
                </span>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Sources" count={d.sources?.length ?? 0}>
        <SourcesTable rows={d.sources ?? []} />
      </Section>

      {d.extraction_metadata && (
        <Section title="Extraction metadata">
          {d.extraction_metadata.contradictions?.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-amber-300/70 mb-2">
                Contradictions ({d.extraction_metadata.contradictions.length})
              </div>
              <ul className="space-y-2 text-sm">
                {d.extraction_metadata.contradictions.map((c: any, i: number) => (
                  <li key={i} className="border-l-2 border-amber-300/40 pl-3">
                    <code className="font-mono text-amber-300/80">{c.field}</code>
                    <div className="text-white/70 mt-0.5">{c.note}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.extraction_metadata.low_confidence_skipped?.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Low-confidence notes ({d.extraction_metadata.low_confidence_skipped.length})
              </div>
              <ul className="space-y-2 text-sm">
                {d.extraction_metadata.low_confidence_skipped.map((c: any, i: number) => (
                  <li key={i} className="border-l-2 border-white/15 pl-3">
                    <code className="font-mono text-white/70">{c.field}</code>
                    <div className="text-white/60 mt-0.5">{c.note}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details>
            <summary className="text-[11px] uppercase tracking-wider text-white/40 cursor-pointer">
              raw extraction_metadata
            </summary>
            <pre className="mt-2 text-[11px] font-mono text-white/60 overflow-x-auto">
              {JSON.stringify(d.extraction_metadata, null, 2)}
            </pre>
          </details>
        </Section>
      )}

      <div className="text-center text-[11px] text-white/30 py-4">
        Hover any value or table row to see source · anchor · page · confidence · quote.
        {openAnnotationCount > 0 && (
          <span className="ml-2 text-amber-300/70">
            · {openAnnotationCount} open annotation{openAnnotationCount === 1 ? "" : "s"} on this product
          </span>
        )}
      </div>

      <div className="text-center">
        <Link href="/" className="text-sm text-white/50">
          ← back to all extractions
        </Link>
      </div>
    </div>
  );
}
