import type { Extraction } from "@/lib/extractions";
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

// Extractions are inconsistent: some table fields land as raw arrays, others as
// {value, evidence} wrappers. Always pull the array regardless of shape.
function asRows(field: any): any[] {
  if (Array.isArray(field)) return field;
  if (field && Array.isArray(field.value)) return field.value;
  return [];
}

function MemoryConfigOptionsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty label="no memory ladder — single fixed memory size" />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Config</th>
            <th className="text-right">Cores / head</th>
            <th className="text-right">Memory / head</th>
            <th className="text-right">Write cache / head</th>
            <th className="text-right">Max heads</th>
            <th>Restrictions</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                {r.name}
                <ConfDot ev={r.evidence} />
              </td>
              <td className="text-right">{r.cores_per_head ?? "—"}</td>
              <td className="text-right">{r.controller_memory_gb_per_head ?? "—"} GB</td>
              <td className="text-right">{r.write_cache_size_gb_per_head ?? "—"} GB</td>
              <td className="text-right">{r.max_heads_per_cluster_at_this_config ?? "—"}</td>
              <td className="text-white/70 text-[12px]">{r.restrictions ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FePortMatrixTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty label="no per-protocol-per-speed matrix — see max_fe_ports_per_head scalar" />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Protocol</th>
            <th className="text-right">Speed</th>
            <th className="text-right">Per head</th>
            <th className="text-right">Per cluster</th>
            <th>Notes</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                <span className="chip">{r.protocol}</span>
                <ConfDot ev={r.evidence} />
              </td>
              <td className="text-right">{r.speed_gbps ?? "—"} Gb/s</td>
              <td className="text-right">{r.max_per_head ?? "—"}</td>
              <td className="text-right">{r.max_per_cluster ?? "—"}</td>
              <td className="text-white/70 text-[12px]">{r.notes ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileProtocolsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty label="not unified — block only" />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Protocol</th>
          <th>Versions</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="font-medium">
              {r.protocol}
              <ConfDot ev={r.evidence} />
            </td>
            <td className="font-mono text-[12px]">
              {Array.isArray(r.versions) && r.versions.length > 0 ? r.versions.join(", ") : "—"}
            </td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SupportedDrivesTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Media</th>
            <th>Form factor</th>
            <th>Interface</th>
            <th>Capacities (TB)</th>
            <th>SED default</th>
            <th>FIPS</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                <span className="chip">{r.media_type}</span>
                <ConfDot ev={r.evidence} />
              </td>
              <td>{r.form_factor}</td>
              <td className="text-white/70">{r.interface}</td>
              <td className="font-mono text-[12px]">
                {Array.isArray(r.capacities_tb) ? r.capacities_tb.join(" / ") : "—"}
              </td>
              <td>
                <span className={r.is_sed_default ? "pill pill-on" : "pill pill-off"}>
                  {r.is_sed_default ? "yes" : "no"}
                </span>
              </td>
              <td className="text-[12px]">
                {Array.isArray(r.fips_options) && r.fips_options.length > 0
                  ? r.fips_options.join(", ")
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

function DriveRaidCompatTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty label="no drive×RAID matrix published" />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Media</th>
            <th className="text-right">Capacity</th>
            <th>RAID widths supported</th>
            <th>Restrictions</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                <span className="chip">{r.media_type}</span>
                <ConfDot ev={r.evidence} />
              </td>
              <td className="text-right">{r.capacity_tb} TB</td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {Array.isArray(r.raid_widths_supported)
                    ? r.raid_widths_supported.map((w: string) => (
                        <span key={w} className="chip">
                          {w}
                        </span>
                      ))
                    : "—"}
                </div>
              </td>
              <td className="text-white/70 text-[12px]">{r.restrictions ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplicationTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Vendor name</th>
            <th>Applies to</th>
            <th>Native</th>
            <th className="text-right">Max km</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                <span className="chip">{r.mode}</span>
                <ConfDot ev={r.evidence} />
              </td>
              <td className="font-medium text-white/90">{r.vendor_name ?? "—"}</td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {Array.isArray(r.applies_to)
                    ? r.applies_to.map((a: string) => (
                        <span key={a} className="chip">
                          {a}
                        </span>
                      ))
                    : "—"}
                </div>
              </td>
              <td>
                <span className={r.is_native ? "pill pill-on" : "pill pill-off"}>
                  {r.is_native ? "native" : "partner"}
                </span>
              </td>
              <td className="text-right">{r.max_distance_km ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LayoutDescriptionsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Layout</th>
          <th className="text-right">Heads (unit 1 / unit 2)</th>
          <th className="text-right">Drive enclosures</th>
          <th>Notes</th>
          <AnnotationHeader enabled={!!slug && !!arrayName} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} title={evidenceTitle(r.evidence)}>
            <td className="font-medium">
              {r.name}
              <ConfDot ev={r.evidence} />
            </td>
            <td className="text-right">
              {r.heads_in_unit_1 ?? "—"} {r.heads_in_unit_2 != null ? ` / ${r.heads_in_unit_2}` : ""}
            </td>
            <td className="text-right">{r.drive_enclosures ?? "—"}</td>
            <td className="text-white/70 text-[12px]">{r.notes ?? "—"}</td>
            <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PowerConsumptionTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty label="no cabinet-level power matrix — see per-head scalars" />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[1100px]">
        <thead>
          <tr>
            <th>Config</th>
            <th className="text-right">Node pairs</th>
            <th className="text-right">Drive enc.</th>
            <th className="text-right">Bay #</th>
            <th className="text-right">Typical kVA (&lt;26°C)</th>
            <th className="text-right">Max kVA (&gt;35°C)</th>
            <th className="text-right">Typical BTU/hr</th>
            <th className="text-right">Max BTU/hr</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="text-[12px]">
                {r.config_name}
                <ConfDot ev={r.evidence} />
              </td>
              <td className="text-right">{r.node_pairs ?? "—"}</td>
              <td className="text-right">{r.drive_enclosures ?? "—"}</td>
              <td className="text-right">{r.system_bay_index ?? "—"}</td>
              <td className="text-right">{r.typical_kva_low_temp ?? "—"}</td>
              <td className="text-right">{r.max_kva_high_temp ?? "—"}</td>
              <td className="text-right text-white/60">{r.typical_btu_per_hr_low_temp?.toLocaleString() ?? "—"}</td>
              <td className="text-right text-white/60">{r.max_btu_per_hr_high_temp?.toLocaleString() ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SecurityFeaturesChips({
  features,
  fieldEvidence,
  slug,
  annotations
}: {
  features: any[];
  fieldEvidence?: any;
  slug?: string;
  annotations?: Annotation[];
}) {
  if (!features?.length) return <Empty />;
  return (
    <div className="flex flex-wrap gap-2">
      {features.map((f, i) => {
        const path = `security_features[${i}]`;
        const fieldAnns = slug && annotations
          ? annotations.filter((a) => a.field_path === path)
          : [];
        // Items can be either a flat string ("secure-boot") or an object
        // ({value, evidence}). When string, evidence lives at the field level.
        const label = typeof f === "string" ? f : (f?.value ?? f?.feature ?? f?.tag ?? "?");
        const itemEvidence = typeof f === "object" && f?.evidence ? f.evidence : fieldEvidence;
        return (
          <span key={i} className="chip inline-flex items-center" title={evidenceTitle(itemEvidence)}>
            {label}
            <ConfDot ev={itemEvidence} />
            {slug && annotations && (
              <AnnotationButton slug={slug} fieldPath={path} annotations={fieldAnns} />
            )}
          </span>
        );
      })}
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

export default function StorageView({ d }: { d: Extraction }) {
  const meta = d.extraction_metadata ?? {};
  const cov = meta.coverage_meta ?? {};
  const annotations = readAnnotations(d.slug).annotations;
  const Field = makeField(d.slug, annotations);

  const overlays: string[] = Array.isArray(d.overlays) ? d.overlays : [];
  const hasSharedFabric = overlays.includes("san-shared-fabric-scale-out");
  const hasFederated = overlays.includes("san-clustered-federated");
  const hasHybridTiered = overlays.includes("san-hybrid-tiered");
  const hasEntryDas = overlays.includes("san-entry-das");

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-white/40">
          {d.vendor} / {d.category} / {d.subcategory ?? "—"} / {d.product_line}
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <h1 className="text-2xl font-semibold">{d.model}</h1>
          <CoverageBadge pct={cov.concrete_pct ?? null} />
        </div>
        <div className="text-[11px] text-white/40 font-mono mt-1">
          /{d.slug} · schema {meta.schema_version ?? "—"} · extracted{" "}
          {meta.extracted_at ?? "—"} · extractor {meta.extractor ?? "—"}
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
            {cov.nulls_by_category && (
              <>
                {" "}
                ({cov.nulls_by_category["source-silent"]?.length ?? 0} source-silent ·{" "}
                {cov.nulls_by_category["not-applicable"]?.length ?? 0} not-applicable ·{" "}
                {cov.nulls_by_category["extraction-gap"]?.length ?? 0} extraction-gap)
              </>
            )}
          </div>
        )}
      </div>

      <Section title="Identity" hint="who and when">
        <dl className="kv">
          <dt>vendor</dt><dd>{d.vendor}</dd>
          <dt>product line</dt><dd>{d.product_line}</dd>
          <dt>model</dt><dd>{d.model}</dd>
          <dt>slug</dt><dd>{d.slug}</dd>
          <Field label="position_in_line" field={d.position_in_line} />
          <Field label="form_factor" field={d.form_factor} />
          <Field label="generation" field={d.generation} />
          <Field label="current_software_version" field={d.current_software_version} />
          <Field label="ga_year" field={d.ga_year} />
          <Field label="eos_date" field={d.eos_date} />
          <Field label="eosp_date" field={d.eosp_date} />
          <Field label="eol_date" field={d.eol_date} />
        </dl>
      </Section>

      <Section title="Controller architecture" hint="topology, scale, ownership">
        <dl className="kv">
          <Field label="controller_topology" field={d.controller_topology} />
          <Field label="scale_model" field={d.scale_model} />
          <Field label="controllers_per_head" field={d.controllers_per_head} />
          <Field label="min_heads_per_cluster" field={d.min_heads_per_cluster} />
          <Field label="max_heads_per_cluster" field={d.max_heads_per_cluster} />
          <Field label="sockets_per_node" field={d.sockets_per_node} />
          <Field label="cores_per_head" field={d.cores_per_head} />
          <Field
            label="controller_memory_gb_per_head"
            field={d.controller_memory_gb_per_head}
            format={(v) => `${v} GB`}
          />
          <Field
            label="write_cache_size_gb_per_head"
            field={d.write_cache_size_gb_per_head}
            format={(v) => `${v} GB`}
          />
          <Field label="write_cache_strategy" field={d.write_cache_strategy} />
          <Field label="drive_ownership_model" field={d.drive_ownership_model} />
          <Field label="backend_drive_bus" field={d.backend_drive_bus} />
          <Field
            label="non_disruptive_controller_hardware_upgrade"
            field={d.non_disruptive_controller_hardware_upgrade}
          />
          <Field label="non_disruptive_software_upgrade" field={d.non_disruptive_software_upgrade} />
        </dl>
      </Section>

      {hasSharedFabric && (
        <Section
          title="Memory configuration ladder"
          count={asRows(d.memory_config_options).length}
          hint="vendor memory tiers (san-shared-fabric-scale-out overlay)"
        >
          <MemoryConfigOptionsTable
            rows={asRows(d.memory_config_options)}
            slug={d.slug}
            annotations={annotations}
            arrayName="memory_config_options"
          />
        </Section>
      )}

      <Section title="Front-end connectivity" hint="ports, modules, FC/Ethernet speeds">
        <dl className="kv">
          <Field label="max_fe_ports_per_head" field={d.max_fe_ports_per_head} />
          <Field label="max_fe_io_module_slots_per_head" field={d.max_fe_io_module_slots_per_head} />
          <Field label="supported_fc_speeds_gbps" field={d.supported_fc_speeds_gbps} />
          <Field label="supported_ethernet_speeds_gbe" field={d.supported_ethernet_speeds_gbe} />
          <Field label="supports_direct_host_attach_fc" field={d.supports_direct_host_attach_fc} />
          <Field
            label="supports_direct_host_attach_ethernet"
            field={d.supports_direct_host_attach_ethernet}
          />
        </dl>
      </Section>

      {hasSharedFabric && (
        <Section
          title="FE port matrix (by protocol × speed)"
          count={asRows(d.max_fe_ports_by_protocol_speed).length}
          hint="per-protocol-per-speed maxes (san-shared-fabric-scale-out overlay)"
        >
          <FePortMatrixTable
            rows={asRows(d.max_fe_ports_by_protocol_speed)}
            slug={d.slug}
            annotations={annotations}
            arrayName="max_fe_ports_by_protocol_speed"
          />
        </Section>
      )}

      <Section title="Protocols" hint="block / file / object + vVols">
        <dl className="kv">
          <Field label="unified_capabilities" field={d.unified_capabilities} />
          <Field label="block_protocols" field={d.block_protocols} />
          <Field label="object_protocols" field={d.object_protocols} />
          {hasSharedFabric && <Field label="mainframe_protocols" field={d.mainframe_protocols} />}
          <Field label="vvol_supported_transports" field={d.vvol_supported_transports} />
        </dl>
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
            file_protocols ({asRows(d.file_protocols).length})
          </div>
          <FileProtocolsTable
            rows={asRows(d.file_protocols)}
            slug={d.slug}
            annotations={annotations}
            arrayName="file_protocols"
          />
        </div>
      </Section>

      <Section title="Drives & expansion" hint="bay layout, drive count limits">
        <dl className="kv">
          <Field label="min_drive_count" field={d.min_drive_count} />
          <Field label="drive_count_increment" field={d.drive_count_increment} />
          <Field label="base_enclosure_drive_bays" field={d.base_enclosure_drive_bays} />
          <Field label="usable_base_enclosure_drive_bays" field={d.usable_base_enclosure_drive_bays} />
          <Field label="base_enclosure_drive_form_factor" field={d.base_enclosure_drive_form_factor} />
          <Field label="max_drives_per_head" field={d.max_drives_per_head} />
          <Field label="max_drives_per_cluster" field={d.max_drives_per_cluster} />
          <Field label="supports_expansion_enclosures" field={d.supports_expansion_enclosures} />
          <Field
            label="max_expansion_enclosures_per_head"
            field={d.max_expansion_enclosures_per_head}
          />
          <Field
            label="max_expansion_enclosures_per_cluster"
            field={d.max_expansion_enclosures_per_cluster}
          />
        </dl>
      </Section>

      <Section title="Supported drives" count={asRows(d.supported_drives).length}>
        <SupportedDrivesTable
          rows={asRows(d.supported_drives)}
          slug={d.slug}
          annotations={annotations}
          arrayName="supported_drives"
        />
      </Section>

      {hasSharedFabric && (
        <Section
          title="Drive × RAID compatibility"
          count={asRows(d.drive_raid_compatibility).length}
          hint="drive-type × RAID-width matrix (san-shared-fabric-scale-out overlay)"
        >
          <DriveRaidCompatTable
            rows={asRows(d.drive_raid_compatibility)}
            slug={d.slug}
            annotations={annotations}
            arrayName="drive_raid_compatibility"
          />
        </Section>
      )}

      <Section title="Capacity">
        <dl className="kv">
          <Field
            label="max_raw_capacity_tb_per_head"
            field={d.max_raw_capacity_tb_per_head}
            format={(v) => `${v} TB`}
          />
          <Field
            label="max_raw_capacity_tb_per_cluster"
            field={d.max_raw_capacity_tb_per_cluster}
            format={(v) => `${v} TB`}
          />
          <Field
            label="max_effective_capacity_pbe_per_head"
            field={d.max_effective_capacity_pbe_per_head}
            format={(v) => `${v} PBe`}
          />
          <Field
            label="max_effective_capacity_pbe_per_cluster"
            field={d.max_effective_capacity_pbe_per_cluster}
            format={(v) => `${v} PBe`}
          />
          {hasSharedFabric && (
            <Field
              label="max_effective_capacity_pbe_mainframe_per_cluster"
              field={d.max_effective_capacity_pbe_mainframe_per_cluster}
              format={(v) => `${v} PBe`}
            />
          )}
          <Field
            label="max_logical_capacity_eb"
            field={d.max_logical_capacity_eb}
            format={(v) => `${v} EB`}
          />
          <Field
            label="open_systems_data_reduction_ratio_guarantee"
            field={d.open_systems_data_reduction_ratio_guarantee}
          />
        </dl>
      </Section>

      <Section title="Resiliency" hint="protection scheme, RAID widths, hot spare">
        <dl className="kv">
          <Field label="protection_scheme_name" field={d.protection_scheme_name} />
          <Field label="protection_levels_supported" field={d.protection_levels_supported} />
          <Field label="raid_widths_supported" field={d.raid_widths_supported} />
          <Field
            label="simultaneous_drive_failures_tolerated"
            field={d.simultaneous_drive_failures_tolerated}
          />
          <Field label="hot_spare_strategy" field={d.hot_spare_strategy} />
        </dl>
      </Section>

      <Section title="Data services" hint="dedup / compression / snapshots / encryption / QoS">
        <dl className="kv">
          <Field label="supports_inline_dedup" field={d.supports_inline_dedup} />
          <Field label="supports_inline_compression" field={d.supports_inline_compression} />
          <Field label="supports_thin_provisioning" field={d.supports_thin_provisioning} />
          <Field label="supports_thin_clones" field={d.supports_thin_clones} />
          <Field label="supports_immutable_snapshots" field={d.supports_immutable_snapshots} />
          <Field label="supports_secure_snapshots" field={d.supports_secure_snapshots} />
          <Field label="supports_qos" field={d.supports_qos} />
          <Field label="supports_data_at_rest_encryption" field={d.supports_data_at_rest_encryption} />
          <Field label="supports_kmip_external_kms" field={d.supports_kmip_external_kms} />
          <Field label="supports_data_tiering" field={d.supports_data_tiering} />
          <Field label="flash_cache_layer_supported" field={d.flash_cache_layer_supported} />
          <Field label="license_model" field={d.license_model} />
        </dl>
      </Section>

      <Section
        title="Replication capabilities"
        count={asRows(d.replication_capabilities).length}
        hint="vendor name preserved (SRDF/S, ActiveDR, SnapMirror Sync, etc.)"
      >
        <ReplicationTable
          rows={asRows(d.replication_capabilities)}
          slug={d.slug}
          annotations={annotations}
          arrayName="replication_capabilities"
        />
      </Section>

      <Section title="Ecosystem (VMware, K8s, automation)">
        <dl className="kv">
          <Field label="supports_vaai" field={d.supports_vaai} />
          <Field label="supports_vasa" field={d.supports_vasa} />
          <Field label="supports_vvols" field={d.supports_vvols} />
          <Field label="supports_srm" field={d.supports_srm} />
          <Field label="supports_csi" field={d.supports_csi} />
          <Field label="supports_terraform" field={d.supports_terraform} />
          <Field label="supports_ansible" field={d.supports_ansible} />
          <Field label="supports_openstack_cinder" field={d.supports_openstack_cinder} />
        </dl>
      </Section>

      <Section title="Management" hint="UI plane, REST, AIOps, GenAI assist">
        <dl className="kv">
          <Field label="mgmt_plane_name" field={d.mgmt_plane_name} />
          <Field label="supports_rest_api" field={d.supports_rest_api} />
          <Field label="supports_aiops_observability" field={d.supports_aiops_observability} />
          <Field label="aiops_product_name" field={d.aiops_product_name} />
          <Field label="supports_genai_assistant" field={d.supports_genai_assistant} />
        </dl>
      </Section>

      <Section title="Physical (per head)">
        <dl className="kv">
          <Field label="rack_units" field={d.rack_units} />
          <Field label="height_mm" field={d.height_mm} format={(v) => `${v} mm`} />
          <Field label="width_mm" field={d.width_mm} format={(v) => `${v} mm`} />
          <Field label="depth_mm" field={d.depth_mm} format={(v) => `${v} mm`} />
          <Field label="weight_kg_empty" field={d.weight_kg_empty} format={(v) => `${v} kg`} />
          <Field label="weight_kg_full" field={d.weight_kg_full} format={(v) => `${v} kg`} />
        </dl>
      </Section>

      {hasSharedFabric && (
        <Section
          title="Physical packaging (system-bay / chassis)"
          hint="san-shared-fabric-scale-out overlay"
        >
          {d.physical_packaging == null ? (
            <Empty label="overlay declared but physical_packaging is null — extraction gap" />
          ) : (
            <>
              <dl className="kv">
                <Field
                  label="packaging_unit_type"
                  field={d.physical_packaging.packaging_unit_type}
                />
                <Field
                  label="max_packaging_units_per_array"
                  field={d.physical_packaging.max_packaging_units_per_array}
                />
                <Field
                  label="bay_dispersion_max_m"
                  field={d.physical_packaging.bay_dispersion_max_m}
                  format={(v) => `${v} m`}
                />
                <Field label="layout_modes" field={d.physical_packaging.layout_modes} />
              </dl>
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                  layout_descriptions ({d.physical_packaging.layout_descriptions?.length ?? 0})
                </div>
                <LayoutDescriptionsTable
                  rows={d.physical_packaging.layout_descriptions ?? []}
                  slug={d.slug}
                  annotations={annotations}
                  arrayName="physical_packaging.layout_descriptions"
                />
              </div>
            </>
          )}
        </Section>
      )}

      <Section title="Power (per-head scalars)" hint="null for cabinet-PDU arrays — see matrix below">
        <dl className="kv">
          <Field label="psu_count_per_head" field={d.psu_count_per_head} />
          <Field label="psu_redundancy" field={d.psu_redundancy} />
          <Field
            label="max_psu_output_w"
            field={d.max_psu_output_w}
            format={(v) => `${v} W`}
          />
          <Field label="psu_input_options" field={d.psu_input_options} />
          <Field label="ac_inlet_connectors" field={d.ac_inlet_connectors} />
          <Field
            label="typical_power_w_per_head"
            field={d.typical_power_w_per_head}
            format={(v) => `${v} W`}
          />
          <Field
            label="max_power_w_per_head"
            field={d.max_power_w_per_head}
            format={(v) => `${v} W`}
          />
          <Field label="energy_star_certified" field={d.energy_star_certified} />
          <Field label="nebs_ready" field={d.nebs_ready} />
        </dl>
      </Section>

      {hasSharedFabric && (
        <Section
          title="Power consumption matrix (per cabinet config)"
          count={asRows(d.power_consumption_table).length}
          hint="cabinet-level power table (san-shared-fabric-scale-out overlay)"
        >
          <PowerConsumptionTable
            rows={asRows(d.power_consumption_table)}
            slug={d.slug}
            annotations={annotations}
            arrayName="power_consumption_table"
          />
        </Section>
      )}

      {hasEntryDas && (
        <Section title="Entry-DAS overlay" hint="san-entry-das overlay fields">
          <dl className="kv">
            <Field label="das_modes_supported" field={d.das_modes_supported} />
            <Field label="direct_attach_host_max" field={d.direct_attach_host_max} />
            <Field label="das_protocol_options" field={d.das_protocol_options} />
            <Field label="storage_bridge_bay_compliant" field={d.storage_bridge_bay_compliant} />
            <Field
              label="single_controller_variant_supported"
              field={d.single_controller_variant_supported}
            />
            <Field label="linear_storage_features" field={d.linear_storage_features} />
            <Field label="virtual_storage_features" field={d.virtual_storage_features} />
          </dl>
        </Section>
      )}

      {hasHybridTiered && (
        <Section title="Hybrid-tiered overlay" hint="san-hybrid-tiered overlay fields">
          <dl className="kv">
            <Field label="tiering_strategy" field={d.tiering_strategy} />
            <Field
              label="tiering_relocation_granularity_mb"
              field={d.tiering_relocation_granularity_mb}
              format={(v) => `${v} MB`}
            />
            <Field label="tiering_relocation_cadence" field={d.tiering_relocation_cadence} />
            <Field label="media_tiers" field={d.media_tiers} />
            <Field label="pool_composition_rules" field={d.pool_composition_rules} />
            <Field label="tiering_active_in_linear_mode" field={d.tiering_active_in_linear_mode} />
            <Field label="tiering_min_drives_per_tier" field={d.tiering_min_drives_per_tier} />
          </dl>
        </Section>
      )}

      {hasFederated && (
        <Section title="Clustered-federated overlay" hint="san-clustered-federated overlay fields">
          <dl className="kv">
            <Field label="cluster_volume_mobility" field={d.cluster_volume_mobility} />
            <Field
              label="cluster_volume_mobility_trigger"
              field={d.cluster_volume_mobility_trigger}
            />
            <Field label="cluster_namespace_scope" field={d.cluster_namespace_scope} />
            <Field label="cluster_storage_pool_scope" field={d.cluster_storage_pool_scope} />
            <Field
              label="cross_appliance_replication_native"
              field={d.cross_appliance_replication_native}
            />
            <Field label="intra_cluster_resilience" field={d.intra_cluster_resilience} />
          </dl>
        </Section>
      )}

      {hasSharedFabric && (
        <Section
          title="Shared-fabric scale-out overlay"
          hint="san-shared-fabric-scale-out overlay fields (tables shown in their own sections above)"
        >
          <dl className="kv">
            <Field label="inter_engine_fabric" field={d.inter_engine_fabric} />
            <Field
              label="inter_engine_fabric_bandwidth_gbps_per_link"
              field={d.inter_engine_fabric_bandwidth_gbps_per_link}
              format={(v) => `${v} Gbps`}
            />
            <Field label="mainframe_capable" field={d.mainframe_capable} />
            <Field label="ficon_topologies_supported" field={d.ficon_topologies_supported} />
            <Field
              label="zhyperlink_port_hardware_present"
              field={d.zhyperlink_port_hardware_present}
            />
            <Field label="zhyperlink_reads_supported" field={d.zhyperlink_reads_supported} />
            <Field
              label="mainframe_data_reduction_ratio_guarantee"
              field={d.mainframe_data_reduction_ratio_guarantee}
            />
            <Field
              label="multi_bay_dispersion_supported"
              field={d.multi_bay_dispersion_supported}
            />
            <Field
              label="multi_bay_dispersion_max_meters"
              field={d.multi_bay_dispersion_max_meters}
              format={(v) => `${v} m`}
            />
          </dl>
        </Section>
      )}

      <Section
        title="Security features"
        count={asRows(d.security_features).length}
        hint="controlled-vocab tags"
      >
        <SecurityFeaturesChips
          features={asRows(d.security_features)}
          fieldEvidence={d.security_features?.evidence}
          slug={d.slug}
          annotations={annotations}
        />
      </Section>

      <Section title="Migration sources">
        <dl className="kv">
          <Field
            label="native_block_migration_sources"
            field={d.native_block_migration_sources}
          />
          <Field
            label="native_file_migration_sources"
            field={d.native_file_migration_sources}
          />
        </dl>
      </Section>

      <Section title="Vendor extensions" hint="Outliers — escape hatch for genuinely vendor-specific data">
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
          {Array.isArray(meta.low_confidence_skipped) && meta.low_confidence_skipped.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Low-confidence notes ({meta.low_confidence_skipped.length})
              </div>
              <ul className="space-y-2 text-sm">
                {meta.low_confidence_skipped.map((c: any, i: number) => (
                  <li key={i} className="border-l-2 border-white/15 pl-3">
                    <code className="font-mono text-white/70">{c.field}</code>
                    <div className="text-white/60 mt-0.5">{c.note}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cov && (
            <div className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Null breakdown
              </div>
              <div className="space-y-2 text-sm">
                {Object.entries(cov.nulls_by_category ?? {}).map(([k, v]) => (
                  <div key={k}>
                    <code className="font-mono text-white/60">{k}</code>{" "}
                    <span className="text-white/40">({(v as any[])?.length ?? 0})</span>
                    {Array.isArray(v) && v.length > 0 && (
                      <ul className="mt-1 ml-4 text-[12px] text-white/60 list-disc">
                        {v.map((field: string, i: number) => (
                          <li key={i}>
                            <code className="font-mono">{field}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
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
