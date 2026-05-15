import Link from "next/link";
import type { Extraction } from "@/lib/extractions";
import { unwrap } from "@/lib/extractions";
import { readAnnotations, type Annotation } from "@/lib/annotations";
import AnnotationButton from "@/app/_components/AnnotationButton";
import {
  AnnotationHeader,
  ConfDot,
  Empty,
  RowAnnotationCell,
  Section,
  evidenceTitle,
  makeField
} from "./_helpers";

type TableProps = {
  rows: any[];
  slug?: string;
  annotations?: Annotation[];
  arrayName?: string;
};

function asRows(field: any): any[] {
  if (Array.isArray(field)) return field;
  if (field && Array.isArray(field.value)) return field.value;
  return [];
}

function StorageConfigsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[1100px]">
        <thead>
          <tr>
            <th>Config</th>
            <th>Architecture</th>
            <th>Media</th>
            <th>vSAN</th>
            <th>Valid for stacks</th>
            <th>Drive layout</th>
            <th>Controller</th>
            <th className="text-right">Cap drives</th>
            <th className="text-right">Cap (TB max)</th>
            <th>GPU</th>
            <th>Deployment modes</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                {r.config_label ?? "—"}
                <ConfDot ev={r.evidence} />
              </td>
              <td>
                <span className="chip">{r.storage_architecture ?? "—"}</span>
              </td>
              <td>
                <span className="chip">{r.media_class ?? "—"}</span>
              </td>
              <td>{r.vsan_type ?? "—"}</td>
              <td className="text-[12px]">
                {Array.isArray(r.valid_for_stacks) ? r.valid_for_stacks.join(", ") : "—"}
              </td>
              <td className="text-[12px] text-white/70">{r.chassis_drive_layout ?? "—"}</td>
              <td className="text-[12px]">
                <div>{r.controller_name ?? "—"}</div>
                <div className="text-white/50">{r.controller_mode ?? "—"}</div>
              </td>
              <td className="text-right text-[12px]">
                {r.capacity_drive_min_count ?? "—"}–{r.capacity_drive_max_count ?? "—"}
              </td>
              <td className="text-right">{r.capacity_total_max_tb ?? "—"}</td>
              <td>
                <span className={r.gpu_supported_in_this_config ? "pill pill-on" : "pill pill-off"}>
                  {r.gpu_supported_in_this_config ? "yes" : "no"}
                </span>
              </td>
              <td className="text-[12px] text-white/70">
                {Array.isArray(r.deployment_modes_supported)
                  ? r.deployment_modes_supported.join(", ")
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

function ValidatedDrivesTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Class</th>
            <th>Media</th>
            <th>Capacities (GB)</th>
            <th>Endurance</th>
            <th>Valid for configs</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                <span className="chip">{r.drive_class ?? "—"}</span>
                <ConfDot ev={r.evidence} />
              </td>
              <td>
                <span className="chip">{r.media ?? "—"}</span>
              </td>
              <td className="font-mono text-[12px]">
                {Array.isArray(r.capacities_gb) && r.capacities_gb.length > 0
                  ? r.capacities_gb.join(", ")
                  : "—"}
              </td>
              <td>{r.endurance ?? "—"}</td>
              <td className="text-[12px] text-white/70">
                {Array.isArray(r.valid_for_storage_configs)
                  ? r.valid_for_storage_configs.join(", ")
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

function ValidatedNicsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Vendor</th>
            <th>Model</th>
            <th className="text-right">Speed</th>
            <th className="text-right">Ports</th>
            <th>RDMA</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                <span className="chip">{r.slot_type ?? "—"}</span>
                <ConfDot ev={r.evidence} />
              </td>
              <td>{r.vendor ?? "—"}</td>
              <td className="text-[12px]">{r.model ?? "—"}</td>
              <td className="text-right">{r.port_speed_gbe ? `${r.port_speed_gbe} GbE` : "—"}</td>
              <td className="text-right">{r.port_count ?? "—"}</td>
              <td className="text-[12px]">
                {Array.isArray(r.rdma_protocols)
                  ? r.rdma_protocols.map((p: string) => (
                      <span key={p} className="chip mr-1">
                        {p}
                      </span>
                    ))
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

function ValidatedGpusTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>GPU</th>
            <th>Vendor</th>
            <th>Form factor</th>
            <th className="text-right">Power</th>
            <th className="text-right">Max qty</th>
            <th>Valid for configs</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                {r.gpu ?? "—"}
                <ConfDot ev={r.evidence} />
              </td>
              <td>{r.vendor ?? "—"}</td>
              <td>
                <span className="chip">{r.form_factor ?? "—"}</span>
              </td>
              <td className="text-right">{r.power_w ? `${r.power_w} W` : "—"}</td>
              <td className="text-right">{r.max_qty ?? "—"}</td>
              <td className="text-[12px] text-white/70">
                {Array.isArray(r.valid_for_storage_configs)
                  ? r.valid_for_storage_configs.join(", ")
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

function CoverageBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const cls =
    pct >= 90 ? "bg-emerald-500/15 text-emerald-300" : pct >= 75 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300";
  return (
    <span className={`pill ${cls}`}>
      {pct.toFixed(1)}% concrete
    </span>
  );
}

export default function HciView({ d }: { d: Extraction }) {
  const meta = d.extraction_metadata ?? {};
  const cov = meta.coverage_meta ?? {};
  const annotations = readAnnotations(d.slug).annotations;
  const Field = makeField(d.slug, annotations);

  const overlays: string[] = Array.isArray(d.overlays) ? d.overlays : [];
  const baseServer = unwrap<string>(d.base_server);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40">
          {d.vendor} / {d.category} / {d.product_line}
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <h1 className="text-2xl font-semibold">{d.model}</h1>
          <CoverageBadge pct={cov.concrete_pct ?? null} />
        </div>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          /{d.slug} · schema {meta.schema_version ?? "—"} · extracted {meta.extracted_at ?? "—"} · extractor {meta.extractor ?? "—"}
        </div>
        {overlays.length > 0 && (
          <div className="text-[11px] text-white/60 mt-2 flex flex-wrap items-center gap-1">
            <span className="text-white/40 uppercase tracking-wider mr-1">overlays</span>
            {overlays.map((o) => (
              <span key={o} className="chip">{o}</span>
            ))}
          </div>
        )}
        {cov.concrete_pct != null && (
          <div className="text-[11px] text-white/50 mt-2">
            {cov.concrete_field_count}/{cov.total_field_count} fields concrete · {cov.null_field_count} null
          </div>
        )}
      </div>

      {unwrap<string>(d.description) && (
        <Section title="Description">
          <Field label="description" field={d.description} />
        </Section>
      )}

      <Section title="Identity" hint="who and base-server cross-link">
        <dl className="kv">
          <dt>vendor</dt><dd>{d.vendor}</dd>
          <dt>product line</dt><dd>{d.product_line}</dd>
          <dt>model</dt><dd>{d.model}</dd>
          <dt>slug</dt><dd>{d.slug}</dd>
          <Field label="product_type" field={d.product_type} />
          <dt>base_server</dt>
          <dd>
            {baseServer ? (
              <Link href={`/products/${baseServer}`} className="text-sky-300 hover:text-sky-200 font-mono text-[12px]">
                {baseServer} ↗
              </Link>
            ) : (
              <span className="text-white/40">—</span>
            )}
            <span className="ml-2 text-[11px] text-white/40">
              (bulk hardware specs inherited — see base server)
            </span>
          </dd>
          <Field label="regulatory_model" field={d.regulatory_model} />
          <Field label="predecessor" field={d.predecessor} />
          <Field label="successor" field={d.successor} />
        </dl>
      </Section>

      <Section title="Stack identity & support" hint="which software stack(s) this node serves">
        <dl className="kv">
          <Field label="consumed_by_stacks" field={d.consumed_by_stacks} />
          <Field label="partner_software_vendors" field={d.partner_software_vendors} />
          <Field label="joint_support_model" field={d.joint_support_model} />
          <Field label="golden_image_release" field={d.golden_image_release} />
        </dl>
      </Section>

      <Section title="Storage architecture envelope" hint="SDS engine, boot media (per-tier specifics below)">
        <dl className="kv">
          <Field label="sds_engines_supported" field={d.sds_engines_supported} />
          <Field label="external_sds_supported" field={d.external_sds_supported} />
          <Field label="boot_media" field={d.boot_media} />
        </dl>
      </Section>

      <Section
        title="Storage configurations"
        count={asRows(d.storage_configurations).length}
        hint="one row per config tier (architecture × media × vSAN type)"
      >
        <StorageConfigsTable
          rows={asRows(d.storage_configurations)}
          slug={d.slug}
          annotations={annotations}
          arrayName="storage_configurations"
        />
      </Section>

      <Section title="Cluster scale & topology">
        <dl className="kv">
          <Field label="cluster_min_nodes" field={d.cluster_min_nodes} />
          <Field label="cluster_max_nodes" field={d.cluster_max_nodes} />
          <Field label="supports_single_node" field={d.supports_single_node} />
          <Field label="supports_witness_cluster" field={d.supports_witness_cluster} />
          <Field label="supports_stretched_cluster" field={d.supports_stretched_cluster} />
          <Field label="supports_satellite_node" field={d.supports_satellite_node} />
          <Field label="supports_dynamic_node" field={d.supports_dynamic_node} />
        </dl>
      </Section>

      <Section
        title="Validated drives"
        count={asRows(d.validated_drives).length}
        hint="HCI-narrowed subset of base server's drive catalog"
      >
        <ValidatedDrivesTable
          rows={asRows(d.validated_drives)}
          slug={d.slug}
          annotations={annotations}
          arrayName="validated_drives"
        />
      </Section>

      <Section
        title="Validated NICs"
        count={asRows(d.validated_nics).length}
        hint="HCI-narrowed NIC qualification + RDMA protocol flag"
      >
        <ValidatedNicsTable
          rows={asRows(d.validated_nics)}
          slug={d.slug}
          annotations={annotations}
          arrayName="validated_nics"
        />
      </Section>

      <Section
        title="Validated GPUs"
        count={asRows(d.validated_gpus).length}
        hint="HCI-narrowed subset of base server's GPU catalog"
      >
        <ValidatedGpusTable
          rows={asRows(d.validated_gpus)}
          slug={d.slug}
          annotations={annotations}
          arrayName="validated_gpus"
        />
      </Section>

      <Section title="Lifecycle management">
        <dl className="kv">
          <Field label="lcm_tooling" field={d.lcm_tooling} />
          <Field label="mgmt_controller" field={d.mgmt_controller} />
          <Field label="mgmt_integration" field={d.mgmt_integration} />
        </dl>
      </Section>

      <Section title="Networking features (HCI-specific)">
        <dl className="kv">
          <Field label="requires_rdma" field={d.requires_rdma} />
          <Field label="supported_rdma_protocols" field={d.supported_rdma_protocols} />
          <Field label="min_storage_network_speed_gbe" field={d.min_storage_network_speed_gbe} format={(v) => `${v} GbE`} />
        </dl>
      </Section>

      <Section title="Vendor extensions" hint="vendor-specific outliers">
        {d.vendor_extensions == null || Object.keys(d.vendor_extensions).length === 0 ? (
          <Empty />
        ) : (
          <pre className="text-[11px] font-mono text-white/70 overflow-x-auto bg-black/30 p-3 rounded">
            {JSON.stringify(d.vendor_extensions, null, 2)}
          </pre>
        )}
      </Section>

      {meta && (
        <Section title="Extraction metadata">
          {Array.isArray(meta.contradictions) && meta.contradictions.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-amber-300/70 mb-2">
                Contradictions ({meta.contradictions.length})
              </div>
              <ul className="space-y-2 text-sm">
                {meta.contradictions.map((c: any, i: number) => (
                  <li key={i} className="border-l-2 border-amber-300/40 pl-3">
                    <code className="font-mono text-amber-300/80">{c.field}</code>
                    <div className="text-white/70 mt-0.5">{c.note}</div>
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
              {JSON.stringify(meta, null, 2)}
            </pre>
          </details>
        </Section>
      )}
    </div>
  );
}
