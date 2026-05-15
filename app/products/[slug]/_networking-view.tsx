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

function PortGroupsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[800px]">
        <thead>
          <tr>
            <th className="text-right">Ports</th>
            <th className="text-right">Native (GbE)</th>
            <th className="text-right">Native (Gb FC)</th>
            <th>Connector</th>
            <th>Purpose</th>
            <th>Breakout</th>
            <th>Breakout speeds</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="text-right font-medium">
                {r.port_count ?? "—"}
                <ConfDot ev={r.evidence} />
              </td>
              <td className="text-right">{r.native_speed_gbe ?? "—"}</td>
              <td className="text-right">{r.native_speed_gb_fc ?? "—"}</td>
              <td className="text-white/70">{r.connector ?? "—"}</td>
              <td>
                <span className="chip">{r.purpose ?? "—"}</span>
              </td>
              <td>
                <span className={r.breakout_supported ? "pill pill-on" : "pill pill-off"}>
                  {r.breakout_supported ? "yes" : "no"}
                </span>
              </td>
              <td className="font-mono text-[12px] text-white/70">
                {Array.isArray(r.breakout_speeds) && r.breakout_speeds.length > 0
                  ? r.breakout_speeds.join(", ")
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

function ProductSkusTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[900px]">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Description</th>
            <th>Airflow</th>
            <th>NOS preinstalled</th>
            <th className="text-right">Optics included</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-mono text-[12px] font-medium">
                {r.sku_number ?? "—"}
                <ConfDot ev={r.evidence} />
              </td>
              <td className="text-[12px] text-white/80">{r.description ?? "—"}</td>
              <td>{r.airflow ?? "—"}</td>
              <td className="text-[12px]">{r.nos_preinstalled ?? "—"}</td>
              <td className="text-right">{r.included_optics_count ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PsuOptionsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[700px]">
        <thead>
          <tr>
            <th className="text-right">Output (W)</th>
            <th>Efficiency</th>
            <th>Input</th>
            <th>Airflow</th>
            <th>Available at launch</th>
            <th>Vendor PN</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="text-right font-medium">
                {r.output_w ?? "—"}
                <ConfDot ev={r.evidence} />
              </td>
              <td>{r.efficiency_class ?? "—"}</td>
              <td>{r.input ?? "—"}</td>
              <td>{r.airflow ?? "—"}</td>
              <td>
                <span className={r.available_at_launch ? "pill pill-on" : "pill pill-off"}>
                  {r.available_at_launch ? "yes" : "no"}
                </span>
              </td>
              <td className="font-mono text-[12px] text-white/70">{r.vendor_part_number ?? "—"}</td>
              <RowAnnotationCell slug={slug} annotations={annotations} arrayName={arrayName} index={i} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupportedOpticsTable({ rows, slug, annotations, arrayName }: TableProps) {
  if (!rows?.length) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[700px]">
        <thead>
          <tr>
            <th>Optic</th>
            <th>Connector</th>
            <th className="text-right">Speed</th>
            <th>Reach</th>
            <th>Notes</th>
            <AnnotationHeader enabled={!!slug && !!arrayName} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} title={evidenceTitle(r.evidence)}>
              <td className="font-medium">
                {r.name ?? r.optic ?? r.part_number ?? "—"}
                <ConfDot ev={r.evidence} />
              </td>
              <td>{r.connector ?? "—"}</td>
              <td className="text-right">{r.speed_gbps ? `${r.speed_gbps} Gb/s` : "—"}</td>
              <td>{r.reach ?? "—"}</td>
              <td className="text-white/70 text-[12px]">{r.notes ?? "—"}</td>
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

export default function NetworkingView({ d }: { d: Extraction }) {
  const meta = d.extraction_metadata ?? {};
  const cov = meta.coverage_meta ?? {};
  const annotations = readAnnotations(d.slug).annotations;
  const Field = makeField(d.slug, annotations);

  const overlays: string[] = Array.isArray(d.overlays) ? d.overlays : [];
  const deviceClass = unwrap<string>(d.device_class);
  const mountingClass = unwrap<string>(d.mounting_class);
  const fabricType = unwrap<string>(d.fabric_type);

  const isSwitch = deviceClass === "switch";
  const isChassisFabric = mountingClass === "chassis-fabric";
  const isVirtual = mountingClass === "virtual-appliance";
  const isEthernet = fabricType === "ethernet";
  const isFc = fabricType === "fibre-channel";
  const isIb = fabricType === "infiniband";

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

      <Section title="Identity" hint="who and when">
        <dl className="kv">
          <dt>vendor</dt><dd>{d.vendor}</dd>
          <Field label="manufacturer" field={d.manufacturer} />
          <dt>product line</dt><dd>{d.product_line}</dd>
          <dt>model</dt><dd>{d.model}</dd>
          <dt>slug</dt><dd>{d.slug}</dd>
          <Field label="device_class" field={d.device_class} />
          <Field label="mounting_class" field={d.mounting_class} />
          {isSwitch && <Field label="fabric_type" field={d.fabric_type} />}
          <Field label="workload_tags" field={d.workload_tags} />
          <Field label="generation" field={d.generation} />
          <Field label="predecessor" field={d.predecessor} />
          <Field label="successor" field={d.successor} />
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
          <Field label="rack_units" field={d.rack_units} />
          <Field label="height_mm" field={d.height_mm} format={(v) => `${v} mm`} />
          <Field label="width_mm" field={d.width_mm} format={(v) => `${v} mm`} />
          <Field label="depth_mm" field={d.depth_mm} format={(v) => `${v} mm`} />
          <Field label="weight_kg" field={d.weight_kg} format={(v) => `${v} kg`} />
          {isChassisFabric && (
            <Field
              label="chassis_io_bay_form_factor_description"
              field={d.chassis_io_bay_form_factor_description}
            />
          )}
        </dl>
      </Section>

      <Section title="Environmental">
        <dl className="kv">
          <Field label="operating_temp_min_c" field={d.operating_temp_min_c} format={(v) => `${v}°C`} />
          <Field label="operating_temp_max_c" field={d.operating_temp_max_c} format={(v) => `${v}°C`} />
          <Field label="operating_temp_extended_supported" field={d.operating_temp_extended_supported} />
          <Field label="operating_humidity_max_percent" field={d.operating_humidity_max_percent} format={(v) => `${v}%`} />
          <Field label="storage_temp_min_c" field={d.storage_temp_min_c} format={(v) => `${v}°C`} />
          <Field label="storage_temp_max_c" field={d.storage_temp_max_c} format={(v) => `${v}°C`} />
          <Field label="operating_altitude_max_m" field={d.operating_altitude_max_m} format={(v) => `${v} m`} />
          <Field label="shock_operating_g" field={d.shock_operating_g} format={(v) => `${v} g`} />
          <Field label="vibration_operating_grms" field={d.vibration_operating_grms} format={(v) => `${v} grms`} />
        </dl>
      </Section>

      {!isChassisFabric && !isVirtual && (
        <Section title="Power & cooling" hint="standalone power group (chassis-fabric inherits from chassis)">
          <dl className="kv">
            <Field label="psu_count_max" field={d.psu_count_max} />
            <Field label="max_psu_output_w" field={d.max_psu_output_w} format={(v) => `${v} W`} />
            <Field label="max_system_power_consumption_w" field={d.max_system_power_consumption_w} format={(v) => `${v} W`} />
            <Field label="typical_system_power_consumption_w" field={d.typical_system_power_consumption_w} format={(v) => `${v} W`} />
            <Field label="psu_redundancy" field={d.psu_redundancy} />
            <Field label="dc_power_supported" field={d.dc_power_supported} />
            <Field label="airflow_direction_options" field={d.airflow_direction_options} />
            <Field label="fan_count_max" field={d.fan_count_max} />
            <Field label="fan_redundancy" field={d.fan_redundancy} />
          </dl>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
              psu_options ({asRows(d.psu_options).length})
            </div>
            <PsuOptionsTable
              rows={asRows(d.psu_options)}
              slug={d.slug}
              annotations={annotations}
              arrayName="psu_options"
            />
          </div>
        </Section>
      )}

      <Section title="Management">
        <dl className="kv">
          <Field label="mgmt_port_type" field={d.mgmt_port_type} />
          <Field label="mgmt_protocols" field={d.mgmt_protocols} />
          <Field label="supports_zero_touch_deployment" field={d.supports_zero_touch_deployment} />
          <Field label="supported_management_software" field={d.supported_management_software} />
          {isChassisFabric && <Field label="mgmt_via_chassis_module" field={d.mgmt_via_chassis_module} />}
        </dl>
      </Section>

      <Section title="Network operating system">
        <dl className="kv">
          <Field label="supported_nos" field={d.supported_nos} />
          <Field label="default_nos" field={d.default_nos} />
          <Field label="supports_onie" field={d.supports_onie} />
          <Field label="nos_compute_memory_gb" field={d.nos_compute_memory_gb} format={(v) => `${v} GB`} />
          <Field label="nos_storage_gb" field={d.nos_storage_gb} format={(v) => `${v} GB`} />
        </dl>
      </Section>

      {isSwitch && (
        <Section title="Switch overlay" hint="port catalog, ASIC, optics, SKUs">
          <dl className="kv">
            <Field label="port_total_count" field={d.port_total_count} />
            <Field label="max_port_speed_gbe" field={d.max_port_speed_gbe} format={(v) => `${v} GbE`} />
            <Field label="max_port_speed_gb_fc" field={d.max_port_speed_gb_fc} format={(v) => `${v} Gb/s FC`} />
            <Field label="supports_breakout" field={d.supports_breakout} />
            <Field label="breakout_speeds" field={d.breakout_speeds} />
            <Field label="asic_name" field={d.asic_name} />
            <Field label="asic_vendor" field={d.asic_vendor} />
          </dl>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
              port_groups ({asRows(d.port_groups).length})
            </div>
            <PortGroupsTable
              rows={asRows(d.port_groups)}
              slug={d.slug}
              annotations={annotations}
              arrayName="port_groups"
            />
          </div>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
              supported_optics ({asRows(d.supported_optics).length})
            </div>
            <SupportedOpticsTable
              rows={asRows(d.supported_optics)}
              slug={d.slug}
              annotations={annotations}
              arrayName="supported_optics"
            />
          </div>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
              product_skus ({asRows(d.product_skus).length})
            </div>
            <ProductSkusTable
              rows={asRows(d.product_skus)}
              slug={d.slug}
              annotations={annotations}
              arrayName="product_skus"
            />
          </div>
        </Section>
      )}

      {isSwitch && isEthernet && (
        <Section title="Ethernet switch overlay" hint="performance envelope, table sizes, NOS capabilities">
          <dl className="kv">
            <Field label="aggregate_throughput_tbps_full_duplex" field={d.aggregate_throughput_tbps_full_duplex} format={(v) => `${v} Tbps`} />
            <Field label="forwarding_capacity_bpps" field={d.forwarding_capacity_bpps} format={(v) => `${v} Bpps`} />
            <Field label="latency_ns_max" field={d.latency_ns_max} format={(v) => `${v} ns`} />
            <Field label="packet_buffer_mb" field={d.packet_buffer_mb} format={(v) => `${v} MB`} />
            <Field label="mac_table_size_k" field={d.mac_table_size_k} format={(v) => `${v}K`} />
            <Field label="ipv4_routes_max_k" field={d.ipv4_routes_max_k} format={(v) => `${v}K`} />
            <Field label="vlans_max_k" field={d.vlans_max_k} format={(v) => `${v}K`} />
            <Field label="vlans_max_metric" field={d.vlans_max_metric} />
            <Field label="supports_l2" field={d.supports_l2} />
            <Field label="supports_l3" field={d.supports_l3} />
            <Field label="supports_bgp" field={d.supports_bgp} />
            <Field label="supports_ospf" field={d.supports_ospf} />
            <Field label="supports_evpn" field={d.supports_evpn} />
            <Field label="supports_vxlan" field={d.supports_vxlan} />
            <Field label="supports_dcb_pfc" field={d.supports_dcb_pfc} />
            <Field label="supports_dcbx" field={d.supports_dcbx} />
            <Field label="supports_ets" field={d.supports_ets} />
            <Field label="supports_iscsi_tlv" field={d.supports_iscsi_tlv} />
            <Field label="supports_routable_roce" field={d.supports_routable_roce} />
            <Field label="supports_nvme_of" field={d.supports_nvme_of} />
            <Field label="supports_mlag" field={d.supports_mlag} />
            <Field label="supports_ptp_1588v2" field={d.supports_ptp_1588v2} />
            <Field label="supports_sdn_fabric" field={d.supports_sdn_fabric} />
            <Field label="supports_stacking" field={d.supports_stacking} />
            <Field label="stack_max_switches" field={d.stack_max_switches} />
            <Field label="stack_max_ports" field={d.stack_max_ports} />
            <Field label="stack_aggregate_bandwidth_gbps" field={d.stack_aggregate_bandwidth_gbps} format={(v) => `${v} Gbps`} />
          </dl>
        </Section>
      )}

      {isSwitch && isFc && (
        <Section title="FC switch overlay" hint="fabric services, FC security, PoD licensing">
          <dl className="kv">
            <Field label="fc_aggregate_throughput_tbps" field={d.fc_aggregate_throughput_tbps} format={(v) => `${v} Tbps`} />
            <Field label="fc_max_speed_gbps" field={d.fc_max_speed_gbps} format={(v) => `${v} Gb/s`} />
            <Field label="fc_speeds_supported" field={d.fc_speeds_supported} />
            <Field label="fc_port_types_supported" field={d.fc_port_types_supported} />
            <Field label="supports_zoning" field={d.supports_zoning} />
            <Field label="supports_npiv" field={d.supports_npiv} />
            <Field label="supports_ficon" field={d.supports_ficon} />
            <Field label="supports_fpin" field={d.supports_fpin} />
            <Field label="ports_on_demand_increments" field={d.ports_on_demand_increments} />
            <Field label="fc_security_features" field={d.fc_security_features} />
          </dl>
        </Section>
      )}

      {isSwitch && isIb && (
        <Section title="InfiniBand switch overlay" hint="IB performance, subnet manager, in-network compute">
          <dl className="kv">
            <Field label="ib_aggregate_throughput_tbps" field={d.ib_aggregate_throughput_tbps} format={(v) => `${v} Tbps`} />
            <Field label="ib_forwarding_capacity_bpps" field={d.ib_forwarding_capacity_bpps} format={(v) => `${v} Bpps`} />
            <Field label="ib_max_speed_gbps" field={d.ib_max_speed_gbps} format={(v) => `${v} Gb/s`} />
            <Field label="ib_speeds_supported" field={d.ib_speeds_supported} />
            <Field label="ib_generation" field={d.ib_generation} />
            <Field label="ib_port_to_port_latency_ns" field={d.ib_port_to_port_latency_ns} format={(v) => `${v} ns`} />
            <Field label="ib_port_total_count" field={d.ib_port_total_count} />
            <Field label="ib_supports_port_splitting" field={d.ib_supports_port_splitting} />
            <Field label="ib_port_split_max_count" field={d.ib_port_split_max_count} />
            <Field label="ib_port_split_speeds_gbps" field={d.ib_port_split_speeds_gbps} />
            <Field label="ib_connector" field={d.ib_connector} />
            <Field label="has_internal_subnet_manager" field={d.has_internal_subnet_manager} />
            <Field label="subnet_manager_max_nodes" field={d.subnet_manager_max_nodes} />
            <Field label="supports_external_ufm" field={d.supports_external_ufm} />
            <Field label="ufm_features_supported" field={d.ufm_features_supported} />
            <Field label="supports_router_capability" field={d.supports_router_capability} />
            <Field label="router_max_subnets" field={d.router_max_subnets} />
            <Field label="fabric_max_nodes" field={d.fabric_max_nodes} />
            <Field label="supports_sharp" field={d.supports_sharp} />
            <Field label="sharp_version" field={d.sharp_version} />
            <Field label="sharp_max_aggregation_trees" field={d.sharp_max_aggregation_trees} />
            <Field label="supports_adaptive_routing" field={d.supports_adaptive_routing} />
            <Field label="supports_self_healing_network" field={d.supports_self_healing_network} />
            <Field label="supports_congestion_control" field={d.supports_congestion_control} />
            <Field label="congestion_control_protocol" field={d.congestion_control_protocol} />
            <Field label="virtual_lane_count" field={d.virtual_lane_count} />
            <Field label="mtu_max_bytes" field={d.mtu_max_bytes} format={(v) => `${v} B`} />
            <Field label="supports_qos" field={d.supports_qos} />
            <Field label="supported_topologies" field={d.supported_topologies} />
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

      <Section title="Certifications & warranty">
        <dl className="kv">
          <Field label="certifications" field={d.certifications} />
          <Field label="nebs_certified" field={d.nebs_certified} />
          <Field label="warranty_class" field={d.warranty_class} />
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
