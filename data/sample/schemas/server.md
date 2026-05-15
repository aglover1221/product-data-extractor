---
name: server-schema
description: Structured-data extraction contract for server products (Dell PowerEdge, HPE ProLiant, Lenovo ThinkSystem, Cisco UCS, Supermicro, etc.). Defines the field set, types, enums, and source-attribution rules that every server extraction must produce. This document is the canonical contract — the on-disk extraction format and any downstream DB schema are derived from it. Active scope (2026-05-07): server_type ∈ {general-purpose, gpu-server, edge, multi-node, modular-sled, scale-up}; gpu-server / edge / multi-node / modular-sled / scale-up trigger composition with their respective overlays under `overlays/`.
type: schema
category: server
last_updated: 2026-05-06
---

<!-- 2026-05-06 audit pass: per `_planning/server-md-parse-deltas-2026-05-06.md`, the GP cohort (25/25 Reducto MDs) drove these deltas, all in this file:
- ADD top-level relation `supported_nics` (unified OCP + PCIe NIC catalog)
- ADD optional rich-spec columns to `storage_controllers`
- TIGHTEN `cpu_skus.threads` from optional → recommended (Dell TG publishes 25/25)
- CLARIFY `ashrae_class_max: rugged` description (broader than edge / NEBS) -->

# Server Schema (Structured Data Extraction Contract)

This is the contract for **structured data** extracted per server product. Inherits the universal directory pattern, source-row schema, and audit-status enum from [`_base.md`](_base.md).

The new pipeline does **not** synthesize prose docs. For every product:

```
{vendor}/server/{product-line}/{model}/
├── source/                       ← PDFs + .md sidecars (Reducto: HTML tables, agentic OCR, inline figure crops)
│   ├── technical-guide.pdf
│   ├── technical-guide.md
│   ├── spec-sheet.pdf
│   └── spec-sheet.md
├── extraction.json               ← structured fields per this schema
└── verify-report.md              ← output of cross-check-extraction skill
```

`extraction.json` is the canonical structured output for the product. The Reducto-rendered `.md` sidecars are the unstructured fallback for queries that fall outside the structured schema. Any database, MCP tool, or web-app representation is downstream of `extraction.json` and conforms to this contract.

## Design intent

- **Capture solution-oriented data only.** What an LLM/agent needs to make IT solution decisions: ceilings, options, supported lists, lifecycle. Marketing prose, narrative architecture, and diagrams stay in the source `.md` sidecars.
- **Enforce the same shape across vendors.** A Lenovo ThinkSystem extraction and a Dell PowerEdge extraction populate the same fields. This is what makes peer-cohort cross-checks possible.
- **Track provenance per value, not per doc.** Every extracted row carries an `evidence` pointer (source filename + section anchor or page) so the verifier can re-locate the claim.
- **Tolerate missing data, mark it.** Fields the source genuinely doesn't speak to are `null` with `evidence: source-silent`. Fields that *should* be there but the extractor missed are `null` with `evidence: null` — the verifier treats these differently.

Names like `cpu_skus`, `supported_dimms`, `drive_configurations` below are **logical relations** in the canonical `extraction.json` (top-level array keys). They are not bound to any specific database table or column — DB schemas, if any, are derived from this contract.

## Overlay routing

Server-domain extractions compose a base schema (this file) with a `server_type`-driven overlay. The overlay set is additive: an overlay can introduce new fields and tighten enums on this base, but it MUST NOT override or remove a base field. A base-only extraction is a valid subset of any overlay-composed extraction; routing is a one-way enrichment.

| `server_type` | Overlay file | Status |
|---|---|---|
| `general-purpose` | none — base only | active |
| `gpu-server` | [`overlays/gpu-server.md`](overlays/gpu-server.md) | active |
| `edge` | [`overlays/edge.md`](overlays/edge.md) | active |
| `multi-node` | [`overlays/multi-node.md`](overlays/multi-node.md) | active |
| `modular-sled` | [`overlays/modular-sled.md`](overlays/modular-sled.md) | active (drafted 2026-05-07; MX760c is gold-set validation target) |
| `scale-up` | [`overlays/scale-up.md`](overlays/scale-up.md) | active |

Deferred server types (locked in `project_server_categorization` memory but not yet in scope): `liquid-cooled-tray`. Will add an overlay when its sub-cohort (HPE Cray XD220v / XD225v in N1380-class chassis) is pulled. Do not pre-author the overlay before the gold set exists.

The composition rule is documented once in `project_hierarchical_schemas` memory: storage requires multi-overlay composition, so the routing layer must support more than single-inheritance even though server today is single-overlay.

## Identity (every server)

These fields uniquely identify a product and inherit from `_base.md` universal frontmatter (`vendor`, `category=server`, `kind=product`, `product_line`, `parent_product_line`, `status`, `last_updated`, `sources`).

Server-specific identity:

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | Canonical name. "PowerEdge R770", "ThinkSystem SR650 V3", not vendor-prefixed twice. |
| `description` | string | yes | One- to two-sentence positioning of the product (≤300 chars). What it is, primary workload, and the niche it fills in the product line. Drawn from the spec sheet's overview blurb. Used for viewer summaries, search, and LLM-context cards. Example (R770): "Dell's flagship 2U dual-socket Intel Xeon 6 server for general-purpose, mixed-workload deployments — supports up to 192 cores per CPU, 32 DIMM slots, and PCIe Gen5 expansion." |
| `slug` | string | yes | Lowercase, hyphenated, scoped to product line directory. R770 → `r770`. |
| `product_line` | string | yes | Slug of parent line. `poweredge`, `thinksystem`, `proliant`. |
| `manufacturer` | string | optional | OEM when distinct from vendor (e.g. NVIDIA-manufactured Dell-resold). Omit when seller=manufacturer. |
| `regulatory_model` | string | optional | Vendor internal code (Dell "E125S"). Omit when vendor doesn't publish one. |
| `predecessor` | string (slug) | optional | Slug of the model this replaces. |
| `successor` | string (slug) | optional | Slug of the model that replaces this. |

## Server type and lifecycle

| Field | Type | Required | Enum / format | Notes |
|---|---|---|---|---|
| `server_type` | enum | yes | `general-purpose` \| `gpu-server` \| `edge` \| `multi-node` \| `modular-sled` \| `scale-up` | The primary positioning. One value. A general-purpose server that supports PCIe GPUs as an option (e.g. R770, R7725, ST650 V3) is `general-purpose` — PCIe-GPU capability is a parameter, not the type. `gpu-server` is reserved for chassis built around GPU compute (SXM/OAM baseboards, or PCIe-GPU-dense 4U+ chassis like DL380a Gen12 / SR675 V3). `edge` is for ruggedized / NEBS-class servers (Dell XR-series). `multi-node` is for compute nodes that install in a multi-node-dense chassis (Dell C-series sleds in C6600, Lenovo SD-prefix in D3, HPE Cray XD nodes in XD2000). `modular-sled` is for compute sleds that install in a *bladed* chassis with integrated fabric switches AND chassis-resident management plane (Dell MX-series sleds in MX7000, HPE Synergy compute modules in Synergy 12000) — the structural difference vs `multi-node` is mezz-card-to-chassis-fabric vs OCP/PCIe-to-TOR. `scale-up` is for ≥4-socket platforms (R860, R960, SR950 V3). Each non-base type composes its respective overlay under `overlays/`. Workload labels (`ai-training`, `ai-inference`, `hpc`, `storage-dense`) are NOT server types — capture them on `workload_tags`. Deferred values (`liquid-cooled-tray`) will activate when their gold sets are pulled. |
| `workload_tags` | list[string] | optional | Free-text-ish vendor positioning tags: "ai-training", "ai-inference", "hpc", "vdi", "database", "storage-dense", "edge", "general-purpose". Captures workload framing the vendor markets the server for, without forcing it into `server_type`. |
| `generation` | string | recommended | Vendor-specific generation (e.g. "17th", "V3", "Gen11", "Gen12"). | One value. The product line MD enumerates the full set. |
| `announced_date` | string | optional | YYYY-MM-DD | When the model was publicly announced. May lag GA by weeks/months. |
| `ga_year` | integer | recommended | YYYY | |
| `ga_month` | integer | optional | 1-12 | |
| `eos_date` | string | optional | YYYY-MM-DD | End of sale — last day vendor sells the product. |
| `eosp_date` | string | optional | YYYY-MM-DD | End of standard product support — last day standard warranty/support runs. |
| `eol_date` | string | optional | YYYY-MM-DD | End of life — last day any support (including extended) is available. |

## Physical dimensions

| Field | Type | Required | Unit / range | Notes |
|---|---|---|---|---|
| `form_factor` | enum | yes | `rack` \| `tower` \| `sled` \| `tray` | The chassis style. Size dimension lives in `rack_units` (cascades to null for `sled` / `tray` — sleds and trays are sized by their bay form factor on the host chassis, captured in the relevant overlay). `chassis` is its own top-level category (see `project_server_categorization` memory) — does not belong here. `sled` is for `server_type ∈ {modular-sled, multi-node}` — compute units that install in a bladed or multi-node-dense chassis. `tray` is for the deferred `liquid-cooled-tray` overlay. |
| `rack_units` | integer | yes when `form_factor=rack` | 1-12 | `null` for tower. |
| `height_mm` | number | recommended | mm | |
| `width_mm` | number | recommended | mm | |
| `depth_mm` | number | recommended | mm | Max chassis depth published by the vendor. |
| `weight_kg` | number | recommended | kg | Max-config weight when published; otherwise nominal. |

## Cooling

| Field | Type | Required | Enum / range | Notes |
|---|---|---|---|---|
| `supports_air` | boolean | yes | | |
| `supports_dlc` | boolean | yes | | Direct liquid cooling. |
| `supports_front_io` | boolean | yes | | Front-serviceability variant exists (rear is the default; this flag captures the exception). |
| `fan_count_max` | integer | recommended | | |
| `fan_redundancy` | string | optional | "N+1", "N+2" | Free text per source. |

## Environmental

Headline operating-envelope scalars and ASHRAE class. Differentiates standard data center chassis (A2) from extended-ambient (A3 / A4) and edge / rugged (`rugged`). Detailed per-config thermal restriction matrices (CPU TDP × GPU presence × max ambient) stay in source `.md` sidecars — these scalars are the comparison summary. The edge overlay layers humidity, altitude, shock / vibration, and certification fields on top.

| Field | Type | Required | Enum / range | Notes |
|---|---|---|---|---|
| `ashrae_class_max` | enum | recommended | `A2` \| `A3` \| `A4` \| `rugged` | Highest ASHRAE class the chassis supports continuously. A2 = 10–35 °C (standard data center), A3 = 5–40 °C, A4 = 5–45 °C. `rugged` = 5–55 °C continuous, often published as "Continuous Operation Specifications for Rugged Environment" alongside the standard A2 envelope. Surfaces on edge chassis (XR-series, NEBS-class) AND on non-edge mainstream PowerEdge SKUs offered as extended-temperature options (R7715, R7725, R7725xd, HS5610, T160, T360, T560 all publish a Rugged-environment table) — the verifier should NOT treat `rugged` on a non-XR product as drift. When the source publishes a single class, capture it; when it publishes a range with derated SKUs (e.g. "A2 standard, A3/A4 with selected SKUs"), capture the highest fully-supported class. |
| `operating_temp_min_c` | number | recommended | °C | Minimum continuous operating ambient. Mainstream rack chassis: 10. Edge / rugged: -5 or lower. The cold-side rating is the primary structured differentiator between rugged and standard chassis. |
| `operating_temp_max_c` | number | recommended | °C | Maximum continuous operating ambient. A2 = 35, A3 = 40, A4 = 45, `rugged` ≥ 55. Continuous, not short-term excursion. Per-config restrictions (CPU TDP × GPU presence × ambient) live in source MDs. |

## CPU

Per-product CPU envelope:

| Field | Type | Required | Notes |
|---|---|---|---|
| `socket_count` | integer | yes | 1, 2, 4, 8. |
| `processor_family` | list[enum] | yes | One or more of: `intel-xeon-6-pcore` \| `intel-xeon-6-ecore` \| `intel-xeon-scalable-4-5g` \| `intel-xeon-6300` \| `intel-xeon-e-2400` \| `intel-pentium-g7400` \| `amd-epyc-9004` \| `amd-epyc-9005` \| `amd-epyc-8004` \| `amd-epyc-4004` \| `amd-epyc-4005`. Many platforms support multiple families on the same socket (Intel 4th- and 5th-gen Xeon Scalable share LGA-4677). Each `cpu_skus` row carries its own `family` tag. Entry-tier values (`intel-xeon-6300` Granite Rapids-D entry, `intel-xeon-e-2400` Raptor Lake-E, `intel-pentium-g7400` Alder Lake-R, `amd-epyc-8004` Siena 6-channel single-socket, `amd-epyc-4004`/`amd-epyc-4005` AM5 entry) added 2026-05-05 after GP fan-out surfaced them across R260/R360/R470/DL20/SR250/ST45/ST50/DL145/C6615. Arm CPUs (NVIDIA Grace, Ampere Altra) are out of pilot scope (no gold-set member ships with Arm) — restore the enum value when DL384 Gen12 or similar enters scope. |
| `memory_channels_per_socket` | integer | recommended | 8 (Intel Xeon 6), 12 (AMD EPYC 9004/9005), etc. |

Per-CPU-SKU table — `cpu_skus`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | "Xeon 6754P", "EPYC 9755". |
| `family` | enum | yes | One of the values from `processor_family`. Ties this SKU to the right CPU family when the platform supports multiple. |
| `clock_ghz` | number | yes | Base clock. |
| `cache_mb` | number | recommended | L3 cache. |
| `cores` | integer | yes | |
| `threads` | integer | recommended | Dell tech guides publish the `Threads` column 25/25 across the GP MD cohort (2026-05-06 audit). Restored to recommended for MVP-Dell scope. HPE QuickSpecs historically omits this column for Xeon E-cores/P-cores; if HPE re-enters scope and proves uneven, downgrade back to optional. AMD EPYC SMT is per-SKU. |
| `memory_speed_mt_s` | integer | recommended | Max memory speed this SKU supports (1DPC). |
| `tdp_w` | integer | yes | |
| `requires_dlc` | boolean | recommended | Some SKUs are DLC-only. |

## Memory

Envelope:

| Field | Type | Required | Notes |
|---|---|---|---|
| `dimm_slots` | integer | yes | |
| `max_memory_gb` | integer | yes | Headline ceiling, **Native DIMMs only** (max-density × slot count). CXL memory is captured separately. Quote the spec sheet's "max memory" value — almost always native-only. |
| `max_memory_speed_mt_s_1dpc` | integer | recommended | At 1 DIMM per channel. |
| `max_memory_speed_mt_s_2dpc` | integer | recommended | At 2 DIMMs per channel. |
| `supports_cxl` | boolean | yes | True if the platform enables CXL memory expansion in any configuration. CPU-vendor support is necessary but not sufficient (e.g. R6715 ships with AMD EPYC 9005 which supports CXL 2.0, but Dell does not enable it on that platform — `supports_cxl: false`). |

CXL envelope (only populated when `supports_cxl: true`; all `null` with `evidence: source-silent` otherwise):

| Field | Type | Required | Notes |
|---|---|---|---|
| `cxl_version` | enum | yes when supported | `1.1` \| `2.0` \| `3.0` |
| `cxl_supported_types` | list[enum] | yes when supported | Subset of `Type-1` (accelerators with cache) \| `Type-2` (accelerators with coherent memory) \| `Type-3` (memory expanders). Most server platforms today: `["Type-3"]`. |
| `cxl_form_factor` | enum | yes when supported | `AIC` (PCIe add-in card) \| `E1.S` \| `E3.S` \| `other`. |
| `cxl_supported_families` | list[enum] | yes when supported | Subset of platform's `processor_family` — which CPU families on **this platform** support CXL. Vendor CPU support ≠ platform CXL support; this is the platform's enable list. |
| `cxl_max_devices_total` | integer | recommended | Max CXL devices supported across all configs. |
| `cxl_max_devices_per_cpu` | integer | recommended | Per-CPU device cap (often 2). |
| `cxl_max_total_memory_gb` | integer | recommended | Max CXL memory (excluding Native DIMMs) across all configs. |
| `cxl_total_system_memory_gb` | integer | recommended | Max Native + CXL combined across all configs. |
| `cxl_constraints` | list[string] | recommended | Verbatim caveats from the source ("Cannot select under 4x DIMMs on AIC", "256 GB within AIC cannot be thermally supported", "x8 AIC must populate x16 CEM slot"). |

Per-CXL-configuration table — `cxl_configurations`. One row per supported CXL deployment configuration. The riser-config dependency is what makes CXL a real PCIe-vs-memory tradeoff:

| Field | Type | Required | Notes |
|---|---|---|---|
| `config_label` | string | yes | Short identifier ("RC7-96GB-launch", "RC3-default"). Free text but stable. |
| `riser_code` | string | yes | Riser-config code. Must match a `riser_configs.config_no`. |
| `slots_used` | list[string] | yes | PCIe slot names this CXL config consumes (e.g. ["Slot 1", "Slot 2", "Slot 7", "Slot 8"]). |
| `native_dimm_config` | string | yes | Required Native DIMM population, verbatim ("32 × 96 GB"). CXL deployment requires this exact native config. |
| `native_dimm_capacity_gb` | integer | yes | Native DIMM capacity total. |
| `cxl_aic_count` | integer | yes | Number of CXL AICs in this config. |
| `cxl_dimm_count_per_aic` | integer | recommended | DIMMs populated per AIC (typically 4). |
| `cxl_dimm_capacity_gb` | integer | recommended | Per-DIMM capacity on the AIC (96 GB, 128 GB). |
| `cxl_total_capacity_gb` | integer | yes | Sum of CXL memory across all AICs in this config. |
| `total_system_memory_gb` | integer | yes | Native + CXL combined for this config. |
| `available_at_launch` | boolean | optional | False for roadmap configs gated on later DIMM density / firmware. |
| `notes` | string | optional | Per-config notes from source. |

Per-DIMM-option table (`supported_dimms`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `dimm_type` | enum | yes | `RDIMM` \| `UDIMM` \| `LRDIMM` \| `MRDIMM` \| `3DS-RDIMM` \| `NVDIMM`. `UDIMM` (unbuffered ECC) added 2026-05-05 — pervasive on entry-tier products (R260/R360/DL20/SR250/ST45/ST50, plus any Xeon 6300 / Xeon E-2400 / Pentium / EPYC 4004/4005 platform). |
| `family` | enum | yes | One of the values from `processor_family`. DIMM support is gated by CPU; must say which family this row applies to. |
| `speed_mt_s_1dpc` | integer | yes | At 1 DIMM per channel — the headline speed this DIMM supports. 4800, 5600, 6400, 8000. |
| `speed_mt_s_2dpc` | integer | recommended | At 2 DIMMs per channel. Often lower than 1DPC (e.g. 96 GB 2R: 6400 @ 1DPC, 5600 @ 2DPC). `null` with `evidence: source-silent` when the platform supports only 1DPC for this DIMM type, or when the source does not break out 2DPC speed for this row. |
| `capacity_gb` | integer | yes | 16, 32, 64, 96, 128, 256. |
| `ranks` | string | optional | "1R", "2R", "4R", "8R". |
| `width` | string | optional | "x4", "x8". |

## Storage

Capacity envelope:

| Field | Type | Required | Notes |
|---|---|---|---|
| `max_drive_count` | integer | yes | Max drive bays across all chassis configs. |
| `max_raw_capacity_tb` | number | recommended | Headline max raw capacity. |

Per-chassis-config table (`drive_configurations`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | string | yes | "8 × 2.5\" SAS/SATA + 8 × E3.S NVMe", "16 × 3.5\" SAS". |
| `drive_count` | integer | yes | |
| `drive_form_factor` | string | yes | "2.5-inch" \| "3.5-inch" \| "E3.S" \| "EDSFF" \| "M.2". |
| `drive_protocols` | list[string] | yes | Subset of `SAS` \| `SATA` \| `NVMe` \| `NVMe-oF`. |
| `is_rear` | boolean | yes | Rear drive bay config. |
| `is_front_io` | boolean | yes | Front-I/O orientation. |
| `max_raw_capacity_tb` | number | optional | Per this config. |

Per-supported-drive table (`supported_drives`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `form_factor` | string | yes | |
| `drive_type` | enum | yes | `SAS-SSD` \| `SATA-SSD` \| `NVMe-SSD` \| `SAS-HDD` \| `SATA-HDD` |
| `speed` | string | optional | "12Gbps SAS", "PCIe Gen5". |
| `drive_class` | string | optional | "Mixed Use", "Read Intensive", "Write Intensive". |
| `capacities` | list[string] | yes | "1.92TB", "3.84TB", "7.68TB", ... |

Storage controllers (`storage_controllers`):

| Field | Type | Required | Enum | Notes |
|---|---|---|---|---|
| `name` | string | yes | | "PERC H965i", "BOSS-N1", "S160". |
| `category` | enum | yes | `Internal RAID` \| `Internal Boot` \| `Software RAID` \| `External RAID` \| `HBA` \| `Other` | |
| `is_external` | boolean | yes | | |
| `pcie_gen` | enum | optional | `Gen3` \| `Gen4` \| `Gen5` | The controller's host PCIe generation. From the 9-column "Storage controller feature matrix" tech-guide tables (9/25 GP cohort surface this; 16/25 publish only the simpler 2-column controller list and cascade to source-silent here). |
| `cache_size_gb` | number | optional | | Onboard write cache in GB. 0 for cacheless HBAs / boot controllers. From "Cache Memory Size" column. |
| `cache_class` | enum | optional | `none` \| `flash-backed` \| `nv-dimm` | Cache backing technology — drives write-heavy workload fit. From "Write Back Cache" column ("Flash Backed Cache", etc.). |
| `raid_levels` | list[integer] | optional | | Subset of [0, 1, 5, 6, 10, 50, 60]. From "RAID Levels" column. Empty `[]` for HBAs that do not implement RAID. |
| `max_drive_support` | integer | optional | | Per-controller drive cap (16 / 50 / 240, sometimes "with SAS Expander"). From "Max Drive Support" column. |

Boot is split across two relations: the controller(s) that handle boot media (rows in `storage_controllers` with `category` ∈ `Internal Boot` / `Software RAID`) and the boot media themselves (`boot_drives`).

Per-boot-drive table — `boot_drives`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `form_factor` | enum | yes | `M.2-NVMe` \| `M.2-SATA` \| `microSD` \| `USB` \| `SD` \| `eMMC` |
| `capacities` | list[string] | recommended | "240GB", "480GB", "960GB". |
| `controller` | string | yes | Name of the controller this boot drive lives behind (must match a `storage_controllers.name`). |
| `redundancy` | enum | recommended | `single` \| `raid-1` \| `raid-0` |
| `notes` | string | optional | "Hot-plug supported", "iDRAC-only access", etc. |

The verifier flags any server with a boot controller but no `boot_drives` rows (and vice versa).

## GPU support (PCIe-only at base; SXM/OAM lives in the gpu-server overlay)

Base captures GPU support that any server (general-purpose or gpu-server) might surface — namely, PCIe-slot-resident GPUs at single- or double-width. SXM/OAM baseboards, named GPU-board SKUs, NVLink topology, and fabric NIC topology are gpu-server-specific and live in [`overlays/gpu-server.md`](overlays/gpu-server.md).

Envelope:

| Field | Type | Required | Notes |
|---|---|---|---|
| `supports_gpu` | boolean | yes | True if any GPU configuration is supported in any chassis variant. |
| `supports_pcie_gpu` | boolean | yes | True if PCIe-slot-resident GPUs are supported. |
| `supports_double_width_gpu` | boolean | yes | True if at least one PCIe slot accepts double-width cards. |
| `max_gpu_power_w` | integer | optional | Max sustained power per PCIe GPU at chassis level (e.g. 75W for SW-only, 450W for high-end DW). **Applies to PCIe-GPU chassis only.** For baseboard hosts (server_type=gpu-server with `gpu_baseboards` non-empty — XE9680, XD685, SR680a V4 class), this field cascades to `evidence: source-silent` — per-GPU TDP lives in overlay's `gpu_baseboards[].per_gpu_tdp_w` instead. Don't double-populate. |

Per-form-factor capacity (`gpu_form_factor_support`) — base scope is PCIe only. The gpu-server overlay extends this with `sxm` / `oam` form factors and adds a separate `gpu_baseboards` relation for named baseboard SKUs:

| Field | Type | Required | Notes |
|---|---|---|---|
| `form_factor` | enum | yes | `single-width` \| `double-width`. (Overlay extends with `sxm` \| `oam`.) |
| `max_count` | integer | yes | |
| `max_power_w_per_gpu` | integer | recommended | |

Supported-GPU table (`supported_gpus`) — base scope is PCIe-form-factor GPUs. Overlay extends form_factor enum and adds baseboard-resident GPU rows:

| Field | Type | Required | Notes |
|---|---|---|---|
| `gpu` | string | yes | "NVIDIA H200 NVL", "NVIDIA L40S", "NVIDIA RTX PRO 6000". |
| `vendor` | enum | yes | `NVIDIA` \| `AMD` \| `Intel`. |
| `form_factor` | enum | yes | `single-width` \| `double-width`. (Overlay extends with `sxm` \| `oam`.) |
| `power_w` | integer | recommended | |
| `max_qty` | integer | recommended | Max in this server. The qty achievable in the riser configs listed in `riser_codes`. When a GPU is qualified at different max counts in different riser configs (e.g. NVIDIA L4 = 2 in RC1/2/7, 4 in RC6/11, 6 in RC12), emit one row per `(model, max_qty, riser_codes)` triple rather than collapsing to a single max. |
| `pcie` | string | optional | "Gen5 x16". |
| `riser_codes` | list[string] | recommended | Riser configs this GPU is qualified in (cross-references `riser_configs.config_no`). Lets a consumer ask "what GPUs does RC11-2 enable?" without traversing the slot map. Empty list `[]` for chassis without a riser-config concept (e.g. baseboard-host gpu-server overlay rows). |

## PCIe expansion

Envelope:

| Field | Type | Required | Notes |
|---|---|---|---|
| `pcie_max_generation` | enum | yes | `Gen3` \| `Gen4` \| `Gen5` \| `Gen6`. The headline generation. Per-slot generations live on `pcie_slots` rows. |
| `max_pcie_slots` | integer | yes | Across all riser configs. |
| `max_rear_pcie_slots` | integer | recommended | |
| `max_front_pcie_slots` | integer | optional | Only if front-I/O variant exists. |

Per-slot table (`pcie_slots`) — the slot map. One row per slot per riser-config combination:

| Field | Type | Required | Notes |
|---|---|---|---|
| `slot_name` | string | yes | "Slot 1", "Slot 2A", "Front Slot 1". |
| `processor` | string | yes | "CPU 1" / "CPU 2" / "shared" / "via riser". |
| `height` | enum | yes | `FH` \| `HHHL` \| `LP` |
| `length` | enum | yes | `HL` \| `FL` \| `3/4-length` |
| `lane_width` | string | yes | "x8", "x16". |
| `pcie_gen` | string | yes | "Gen5". |
| `power_class` | enum | recommended | `≤75W` \| `>75W` \| `DLC` \| `unspecified` |
| `riser_codes` | list[string] | yes when not `is_always_on` | Riser configs this slot is active in. The slot map plus these codes define the GPU-vs-NIC tradeoff: a slot active only in riser-config-3 means a customer choosing that config to host GPUs forfeits the slots active only in other configs. |
| `is_always_on` | boolean | yes | Embedded slot, available in every riser config. |

Per-riser-config table (`riser_configs`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `config_no` | string | yes | "Config 0", "Config 3". |
| `riser_configuration` | string | yes | Vendor's description, verbatim. |
| `cpus` | integer | recommended | 1 or 2 (some configs require both). |
| `slot_count` | integer | recommended | Computed from active slots. |
| `use_case` | string | recommended | "GPU-dense", "NIC-dense", "Front-I/O", "Rear storage". |
| `rear_storage_possible` | boolean | recommended | True when this riser config exposes rear-bay drives. Captures the front-PERC vs rear-storage exclusivity that the slot map alone doesn't surface — a riser may forfeit rear E3.S to free its lanes for GPU x16 connectors. |
| `perc_support` | enum | recommended | `front` \| `rear` \| `none` — which PERC mounting position this riser config qualifies. `none` = no internal RAID controller available with this riser; the customer is on software RAID or boot-only (BOSS). |

DPU support sits with PCIe (and OCP, separately):

| Field | Type | Required | Notes |
|---|---|---|---|
| `supports_dpu` | boolean | yes | |
| `dpu_support_mode` | enum | yes when supported | `inline-ocp` \| `via-mic` \| `pcie-card` \| `not-supported` |

Per-supported-DPU table (`supported_dpus`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | "BlueField-3 B3220". |
| `vendor` | string | yes | |
| `port_speed` | string | recommended | |
| `port_count` | integer | recommended | |

## LOM (LAN on motherboard)

| Field | Type | Required | Enum | Notes |
|---|---|---|---|---|
| `lom_available` | enum | yes | `yes` \| `no` \| `optional` | |
| `lom_port_count` | integer | yes when present | | |
| `lom_speeds_gbe` | list[integer] | yes when present | | [1, 10, 25] etc. |
| `lom_port_types` | list[string] | recommended | | "BT", "SFP+", "SFP28". |

## OCP NIC slot capability

This describes the slot, not specific NIC SKUs. Cards are fluid; slot capability is the structured fact.

| Field | Type | Required | Notes |
|---|---|---|---|
| `ocp_slot_count` | integer | yes | **Max simultaneously-enabled OCP slots in any single chassis configuration.** 0 if no OCP slot. Do NOT count physical OCP positions across mutually-exclusive configs (e.g. front-vs-rear OCPs that the chassis disallows enabling together). The buyer-decision question is "how many OCP NICs can I run in this server at once?" — that's the answer here. Document multi-position chassis details (HPE DL380 Gen12 has 4 positions but only 2 enabled at once due to front/rear NCSI exclusivity) in `vendor_extensions`. |
| `ocp_generation` | string | yes when slot ≥ 1 | "OCP 3.0". |
| `ocp_form_factor` | enum | yes when slot ≥ 1 | `SFF` \| `LFF` |
| `ocp_pcie_gen` | string | yes when slot ≥ 1 | "Gen5". |
| `ocp_lane_widths` | list[string] | yes when slot ≥ 1 | ["x8", "x16"]. |
| `ocp_max_ports` | integer | recommended | |
| `ocp_max_port_speed_gbe` | integer | recommended | |
| `ocp_port_types` | list[string] | recommended | "BT", "SFP+", "SFP28", "QSFP28", "QSFP56", "QSFP-DD". |
| `ocp_power_envelope_w` | integer | optional | |
| `ocp_mgmt_features` | list[string] | optional | "NC-SI", "SNAPI", "WoL", "Shared LOM". |
| `ocp_supports_dpu` | boolean | recommended | |

## Supported NICs (catalog)

Per-supported-NIC-card table — `supported_nics`. Captures the vendor-validated NIC SKU catalog: which OCP and PCIe NIC cards Dell / HPE / Lenovo qualify for the chassis. Distinct from `## OCP NIC slot capability` (which describes the slot, not the cards), `## LOM` (built-in NICs), and `## PCIe expansion` (which describes the slots).

Surfacing pattern in Dell tech guides (validated 2026-05-06 against 25-product GP MD cohort): **22/25** rack and HS chassis publish a `Table N. Supported OCP cards` table after the OCP feature-list table. **3/25** towers (T160 / T360 / T560) lack OCP entirely and instead publish `Table N. Supported network cards` listing PCIe NICs in the same five-column shape. The unified relation below carries both, distinguished by `slot_type`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `slot_type` | enum | yes | `OCP` \| `PCIe`. Discriminator. `OCP` rows live in the OCP slot defined under `## OCP NIC slot capability`; `PCIe` rows live in a regular PCIe slot from `pcie_slots`. |
| `vendor` | string | yes | Card vendor verbatim ("Mellanox", "Broadcom", "Intel", "NVIDIA"). |
| `port_type` | string | yes | "BT" \| "SFP+" \| "SFP28" \| "QSFP28" \| "QSFP56" \| "QSFP112" \| "QSFP-DD" \| "OSFP". Free string — vendor convention. |
| `port_speed_gbe` | integer | yes | Per-port headline speed in GbE: 1, 10, 25, 100, 200, 400. |
| `port_count` | integer | yes | Ports per card (1, 2, 4). |
| `form_factor` | enum | recommended | `OCP 3.0 SFF` \| `OCP 3.0 LFF` \| `PCIe FH` \| `PCIe LP` \| `PCIe HHHL`. For `slot_type: OCP`, almost always `OCP 3.0 SFF` in cohort. For `slot_type: PCIe`, mirrors `pcie_slots.height` shape. |
| `model` | string | optional | Card SKU when published verbatim ("ConnectX-6 Lx", "BCM5719"). Often only the vendor + speed + port count are surfaced; this field is for the cases where the source includes the SKU. |

Solution-decision use: a buyer asking "can I run a BlueField-3 OCP DPU AND a 200 GbE OCP NIC simultaneously?" cross-references `ocp_slot_count` (capacity) against `supported_nics` (which cards are qualified). DPUs continue to live in the dedicated `supported_dpus` relation — `supported_nics` covers traditional NICs only.

## Management interface

| Field | Type | Required | Notes |
|---|---|---|---|
| `mgmt_controller` | string | yes | "iDRAC10", "iLO 7", "XClarity Controller XCC2". |
| `mgmt_port` | string | recommended | "1GbE BASE-T", "Dedicated USB-C". |

## Power

| Field | Type | Required | Notes |
|---|---|---|---|
| `psu_count_max` | integer | yes | |
| `psu_redundancy` | string | recommended | Vendor-published redundancy convention. Common patterns: `1+0` (no redundancy), `1+1` (active/standby), `2+2` (split bus), `N+1` (e.g. N=3, 1 standby), `5+1` (XE9680-class 6-PSU chassis). Free-text — vendor convention varies enough that an enum is hostile. |
| `max_psu_output_w` | integer | yes | Largest available PSU. |
| `best_psu_efficiency_class` | enum | recommended | `Bronze` \| `Silver` \| `Gold` \| `Platinum` \| `Titanium` |
| `dc_power_supported` | boolean | yes | |

Per-PSU-option table (`psu_options`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `output_w` | integer | yes | |
| `efficiency_class` | string | yes | "Titanium". |
| `input` | enum | yes | `AC` \| `DC` \| `AC/DC` |
| `available_at_launch` | boolean | recommended | |

## Security features

`security_features` is a list of normalized tags. The schema fixes the vocabulary so peer-cohort comparisons are direct.

| Tag | Meaning |
|---|---|
| `signed-firmware` | Cryptographically signed firmware. |
| `data-at-rest-encryption` | SED / SEKM. |
| `secure-boot` | UEFI Secure Boot. |
| `secured-component-verification` | Vendor SCV (Dell), iLO Server Platform Cert (HPE). |
| `silicon-root-of-trust` | Vendor's hardware RoT. |
| `secure-erase` | Drive secure-erase orchestration. |
| `system-lockdown` | Configuration lockdown mode. |
| `tpm-2.0-fips` | TPM 2.0 FIPS-certified. |
| `tpm-2.0-cc-tcg` | TPM 2.0 CC-TCG-certified. |
| `chassis-intrusion-detection` | |

If a vendor publishes a security feature not on this list, add a row but flag it for vocabulary review (don't extend the enum on the fly).

## Supported OS

`supported_os` rows. Normalize names to vendor + product, no version unless the vendor explicitly says "X.Y only". Examples:

- `Canonical Ubuntu Server LTS`
- `Microsoft Windows Server`
- `Red Hat Enterprise Linux`
- `SUSE Linux Enterprise Server`
- `VMware ESXi`
- Vendor-specific: `Dell NativeEdge OS`, `HPE GreenLake OS`.

## Provenance — how every value attributes its source

Every extracted value (scalar, list element, table row) carries an `evidence` object:

```yaml
evidence:
  source: technical-guide.md     # filename in source/ — the Reducto .md sidecar
  anchor: "Table 12. Memory speed by CPU SKU"   # heading or table caption
  page: 28                       # PDF page (Reducto preserves page anchors)
  quote: "DDR5-6400 RDIMMs supported with Intel Xeon 6 P-core SKUs only"
  confidence: 0.92               # 0-1, extractor's self-report
```

For table-row values, attach `evidence` at the row level. For envelope scalars, attach at the field level.

`evidence: source-silent` is a special marker meaning the extractor read the relevant section and the source did not specify the value — distinct from "the extractor missed it" (which is `evidence: null`). The verifier weights these differently.

## What this schema does NOT capture

These live in the source `.md` sidecars, not the structured layer:

- Architecture narrative ("how the platform is wired").
- Marketing positioning paragraphs.
- Step-by-step deployment / admin instructions.
- Diagrams, photos, exploded views.
- Detailed thermal envelopes and ambient curves.
- Per-cable / per-connector layout details beyond the slot map.
- Vendor warranty and support tier descriptions (these belong in `{vendor}/support/support.md`, not per product).

Queries that need any of the above fall back to the source `.md` sidecars.

## Notes for the verifier (`cross-check-extraction`)

The verifier uses this schema to drive three checks:

1. **Required-field completeness.** Any field marked `Required: yes` that's `null` is a `fail`. Any `recommended` that's `null` AND populated on ≥80% of peer cohort is a `warn`.
2. **Enum / type validation.** Values outside the declared enum or wrong type are `fail`.
3. **Peer-cohort distribution.** For numeric and list-length fields, the verifier compares the target against a peer cohort (same processor family + same form factor + same generation cohort across vendors). Outliers >3 standard deviations from the peer median are `warn`; >5 are `fail`.

The verifier does NOT check that extracted values match source text — that's the LLM-extraction job's responsibility (and the `evidence.quote` field is its receipt). The verifier checks the *shape* of the extraction.

## Vendor extensions

Fields that are vendor-specific (e.g. Dell SmartFlow, HPE Silicon Root of Trust naming) live in a `vendor_extensions` object on the product:

```yaml
vendor_extensions:
  dell:
    smart_flow_chassis: true
    idrac_features: ["GPU telemetry", "Thermal manager"]
  lenovo:
    machine_types: ["7D75", "7D76"]   # Lenovo's per-warranty-variant identifier; analog to Dell `regulatory_model`
```

Cross-vendor concepts that have only emerged from one vendor so far (DLC variants, edge ruggedization, Lenovo `machine_types`) start in `vendor_extensions` and graduate to first-class fields once a second vendor exposes the same concept.
