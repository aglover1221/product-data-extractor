---
name: modular-sled-overlay
description: Additive overlay on top of server.md for `server_type: modular-sled`. Composes the chassis_membership pattern from `_base.md` and adds modular-sled-specific fields (fabric mezzanine slots, supported mezzanine cards, sled-specific BMC federation) for compute sleds that install in a bladed chassis (Dell MX7000, HPE Synergy 12000). Distinct from `multi-node` (which installs in a multi-node-dense chassis with no integrated fabric and no chassis-resident management plane). Examples: Dell PowerEdge MX760c / MX750c-Gen11 / MX840c (in MX7000); HPE Synergy 480 Gen11 / Synergy 660 Gen10 / Synergy 480 Gen10 (in Synergy 12000).
type: schema-overlay
parent: server.md
applies_when: server_type == modular-sled
last_updated: 2026-05-07
---

# Modular sled server overlay (additive)

Extends `server.md` for the `modular-sled` `server_type`. Modular sleds are compute units that install into a **bladed** chassis with integrated fabric switches AND a chassis-resident management plane. The chassis owns the fabric (Ethernet / FC / IB switches in dedicated I/O module bays) and the lifecycle plane (OME-Modular / Synergy Composer / OneView). The sled has its own BMC for in-band telemetry but is operationally federated under the chassis MM.

Composition rule: **additive only.** Cannot remove or override base fields.

## Design intent

- **Composes the `chassis_membership` pattern** from `_base.md`. The eight canonical chassis-resident fields (`installs_in_chassis_slug`, `installs_in_chassis_vendor`, `host_chassis_type`, `bay_form_factor`, `bay_consumption_count`, `units_per_chassis_max`, `shares_chassis_power_and_cooling`, `chassis_managed_lifecycle`) are populated identically across multi-node, modular-sled, and chassis-fabric overlays. Field semantics are documented once in `_base.md`.
- **The structural discriminator vs `multi-node` is `chassis_managed_lifecycle: true` AND chassis-fabric mezzanines.** The chassis MM orchestrates firmware roll, deployment, profile templating across all sleds. The sled has a BMC (iDRAC / iLO / XCC) that the MM federates — `mgmt_controller` (base) names the BMC; the orchestration plane is named by the host chassis's `mgmt_module_name`.
- **The fabric-NIC vehicle is mezzanine cards, not OCP/PCIe-to-TOR.** A bladed sled connects to the chassis's integrated fabric switches via mezzanine cards in fabric-specific mezz slots (Dell calls them "Mezz A / Mezz B / Mini Mezz" against Fabrics A/B/C; HPE calls them "Mezzanine cards" against Synergy Interconnect Modules). Top-of-rack networking is replaced by chassis-internal fabric. Base server.md's `## OCP NIC slot capability` and `## Supported NICs` typically cascade to silent / empty for modular-sleds — networking lives in this overlay's `mezzanine_slots` and `supported_mezzanine_cards` relations.
- **Shared resources are chassis-scope.** Base `psu_count_max`, `max_psu_output_w`, `fan_count_max` capture chassis-level values on a modular-sled — each sled sees the chassis's PSU envelope. Document this in `evidence.notes` per the multi-node convention.

## Top-level fields

| Field | Type | Required | Notes | Surfaced by |
|---|---|---|---|---|
| (composes chassis_membership pattern — see `_base.md`) | — | — | All 8 canonical fields populated. `host_chassis_type` is always `bladed`. `chassis_managed_lifecycle` is always `true` (the discriminator vs multi-node). `shares_chassis_power_and_cooling` is always `true`. `bay_form_factor` is one of `single-width` / `double-width` / `half-height` / `full-height`. | All modular-sled |
| `independent_sled_bmc` | boolean | yes | True when each sled retains its own BMC (iDRAC / iLO / XCC) for in-band telemetry, federated under the chassis MM. ALWAYS true on modern modular-sleds — base server.md's `mgmt_controller` continues to name the per-sled BMC. False would indicate a sled with no in-band BMC at all (none seen in cohort). Distinct from `chassis_managed_lifecycle`: a sled has BOTH an independent BMC AND chassis-orchestrated lifecycle — the BMC is the in-band telemetry endpoint that the MM federates over. | All modular-sled (uniformly true) |

## Fabric mezzanine slots — `mezzanine_slots`

Distinct from base's `## OCP NIC slot capability` (TOR-facing) and `## PCIe expansion` (general-purpose PCIe). This relation captures the **chassis-fabric-facing** mezzanine slots: physical slots that accept fabric mezzanine cards which connect over the chassis midplane to integrated fabric switches in the chassis's I/O module bays.

The relation is modular-sled-specific. A general-purpose / multi-node server has no chassis-fabric to connect to and leaves this empty. PCIe-GPU-dense gpu-server chassis without bladed connection also leave it empty.

| Field | Type | Required | Notes |
|---|---|---|---|
| `slot_name` | string | yes | Vendor verbatim. Dell: "Mezz A", "Mezz B", "Mini Mezz". HPE: "Mezzanine 1", "Mezzanine 2", "Mezzanine 3". Free string — vendor convention. |
| `fabric_designation` | string | yes | Which chassis fabric this slot connects to. Dell MX: "Fabric A", "Fabric B", "Fabric C". HPE Synergy: "Interconnect Bays 1+4", "Interconnect Bays 2+5", "Interconnect Bays 3+6". Lets a buyer reason "I need a 100GbE fabric in Fabric A — what mezz card goes in Mezz A?" Cross-references `chassis.fabric_io_module_bays` semantics. |
| `fabric_purpose` | enum | yes | `general-purpose` \| `storage` \| `composable-fabric`. `general-purpose` = Ethernet / IB (Fabric A/B). `storage` = FC / FCoE / SAS (Fabric C). `composable-fabric` = HPE Synergy fabric / Dell Scalable Fabric class — fabric that can be Ethernet OR FC depending on switch SKU. Same enum used by chassis-fabric overlay. |
| `pcie_gen` | string | yes | Slot's PCIe generation. "Gen4", "Gen5". |
| `lane_width` | string | yes | "x16", "x8". |
| `processor` | string | recommended | "CPU 1" / "CPU 2" / "shared". Mezz slots commonly tie to a specific CPU's PCIe lanes. |
| `max_port_speed_gbe` | integer | recommended | Max Ethernet speed achievable in this slot via supported mezz cards. MX760c Mezz A/B: 100 GbE. |
| `max_fc_speed_gb` | integer | optional | Max Fibre Channel speed for storage-purpose slots. MX760c Mezz C: 32 Gb FC. |
| `is_fio_blocked` | boolean | optional | True when populating this mezz forfeits front-I/O slots / storage bays (chassis routing constraint). |

## Supported mezzanine cards — `supported_mezzanine_cards`

Per-mezz-card-SKU table. Captures the fabric-NIC catalog (vendor-validated mezz SKUs) the sled is qualified with. Distinct from base's `supported_nics` (which covers OCP + PCIe NICs to TOR — typically empty / cascaded on modular-sled).

| Field | Type | Required | Notes |
|---|---|---|---|
| `mezz_model` | string | yes | Vendor's mezz product name. "ConnectX-6 Lx Dual Port 25 GbE Mezz", "QLogic 32GFC Dual Port FC Mezz", "Mellanox ConnectX-7 Dual Port 100 GbE Mezz". Verbatim. |
| `vendor` | string | yes | Card vendor. "Mellanox", "Broadcom", "Intel", "QLogic", "Marvell". |
| `slot_compatibility` | list[string] | yes | Which `mezzanine_slots.slot_name` values this mezz fits in. ["Mezz A", "Mezz B"] is common for general-purpose mezz; ["Mini Mezz"] for storage-specific. |
| `fabric_type` | enum | yes | `Ethernet` \| `FC` \| `IB` \| `Ethernet-or-FC` (composable). |
| `port_count` | integer | yes | Per-card port count. 2 or 4 typically. |
| `port_speed_gbe` | integer | yes when `fabric_type ∈ {Ethernet, IB, Ethernet-or-FC}` | Per-port speed in GbE. 25, 100, 200. |
| `port_speed_fc_gb` | integer | yes when `fabric_type = FC` | Per-port speed in Gb FC. 16, 32, 64. |
| `port_type` | string | recommended | "KR" (chassis backplane), "SFP-DD", "QSFP28". For mezz, almost always backplane-routed (no external port — connects through chassis midplane). |
| `compatible_switch_modules` | list[string] | optional | Slugs of `chassis-fabric` networking products this mezz is qualified to talk to. Lets a buyer compose "MX760c with ConnectX-7 100GbE mezz in Mezz A → MX9116n in Fabric A I/O bay" without re-deriving compatibility from vendor matrices. Cross-references `networking/{vendor}/{product-line}/{slug}/extraction.json` where `mounting_class: chassis-fabric`. |
| `supports_dpu` | boolean | optional | True for BlueField-class mezz when offered. |
| `notes` | string | optional | "Storage-only", "FCoE-capable", "Hot-pluggable". |

## Cross-field constraints (verifier-enforced)

The chassis_membership pattern's universal constraints from `_base.md` apply. Modular-sled-specific constraints:

1. **`host_chassis_type` MUST equal `bladed`.** A modular-sled in a multi-node-dense or liquid-cooled-rack chassis is a category mismatch — fail.
2. **Referenced chassis MUST have `shared_management_model ∈ {dedicated-module, dual-class-modules}`.** Bladed chassis with `shared_management_model: none` is theoretically possible but cohort-absent; warn if observed.
3. **`chassis_managed_lifecycle` MUST equal `true`.** If a sled is operationally managed independently of a chassis MM, it belongs in `multi-node`, not `modular-sled` — fail.
4. **`independent_sled_bmc: false`** is allowed but cohort-absent across MX-series and Synergy. Fail if it conflicts with a populated `mgmt_controller` field on base.
5. **`mezzanine_slots` MUST be non-empty.** A sled with zero mezz slots cannot connect to chassis fabric and is misclassified — fail.
6. **At least one `mezzanine_slots` row MUST have `fabric_purpose: general-purpose`.** Storage-only fabric without general-purpose Ethernet leaves the sled without a TOR-equivalent — cohort-absent.
7. **Each `supported_mezzanine_cards` row's `slot_compatibility` values MUST resolve to a `mezzanine_slots.slot_name`.** Verifier flags orphan mezz-to-slot references as fail.

## Distinctions vs adjacent server_types

- **vs `multi-node`** (active): multi-node installs in a *multi-node-dense* chassis (D3, XD2000, C6600) with no integrated fabric switches and no chassis-resident mgmt plane. Networking is per-node OCP/PCIe to TOR. Each node is operationally independent (`chassis_managed_lifecycle: false`).
- **vs `liquid-cooled-tray`** (deferred): liquid-cooled-tray installs in a *liquid-cooled-rack* chassis (N1380) with chassis-resident DLC manifold + facility-water. Trays may share many of the modular-sled fields but DLC is the discriminator (`host_chassis_type: liquid-cooled-rack`).
- **vs `general-purpose`**: general-purpose is a standalone rack/tower with its own PSUs, fans, TOR-NICs, and BMC. Modular-sled cannot operate without its bladed chassis (`requires_chassis_to_operate: true`).

## Sub-shapes within the modular-sled cohort

- **Dell MX-series sleds in MX7000.** MX760c (1U single-width, dual-socket Intel Xeon), MX750c-Gen11 (single-width Sapphire Rapids), MX840c (1U double-width, quad-socket Intel Xeon). MX-series storage sleds (MX5016s) are out of server scope; live as chassis-side `supported_storage_sleds` reference and (post-MVP) under storage category.
- **HPE Synergy compute modules in Synergy 12000.** Synergy 480 Gen11 (half-height), Synergy 660 Gen10 (full-height, 4-socket), Synergy 280 Gen10 (half-height single-CPU). Out of MVP scope (post-Dell).

## Gold-set evidence map

| Overlay field | Surfaced by (Dell MX cohort, MVP) |
|---|---|
| chassis_membership 8 canonical fields | All MX-series — extract from spec sheet's "MX7000 chassis" sections plus tech guide's chassis-internals figure |
| `bay_form_factor`, `units_per_chassis_max` | Single sentence in spec sheet ("Up to 8 independent hot-swappable, 1U single-width compute sled in a MX7000 chassis" — MX760c spec sheet) |
| `chassis_managed_lifecycle: true`, `independent_sled_bmc: true` | All — uniformly true; verifier-enforced |
| `mezzanine_slots` | All MX — Dell tech guide's "Internal PCIe Slots" section + chassis-fabric narrative ("MX7000 chassis Fabric options: up to 2 pairs redundant general purpose switch or passthrough modular bays (Fabrics A and B); redundant pair of storage specific switch bays (Fabric C)") |
| `supported_mezzanine_cards` | All MX — Dell tech guide's "Supported NICs" table (mezz cards listed alongside) — typically 8-12 mezz SKUs per sled |
| `compatible_switch_modules` | Cross-reference to chassis-fabric networking products — MX9116n / MX5108n / MXG610s slugs depending on fabric_type |

## Reclassification of existing extractions

The following Dell products carry `server_type: modular-sled`: MX760c, MX750c-Gen11 (when present), MX840c (when present). Sources for MX760c are on disk (2026-05-04 migration); extraction pending in the upcoming Dell portfolio fan-out.

HPE Synergy compute modules (Synergy 480 Gen11, Synergy 660 Gen10, etc.) are post-MVP — sources not pulled.

## What this overlay does NOT do

- Does not redefine any base server.md field.
- Does not redefine the chassis_membership pattern fields — they live in `_base.md`.
- Does not duplicate the chassis spec — chassis lives under `chassis/{vendor}/{product-line}/...` and is referenced by slug.
- Does not model multi-node sleds — that's `multi-node` overlay. The discriminator is `host_chassis_type` + `chassis_managed_lifecycle`.
- Does not model liquid-cooled trays — that's the deferred `liquid-cooled-tray` overlay.
- Does not capture chassis-level fabric switch SKUs — those live as networking products under `networking/{vendor}/{product-line}/{slug}/extraction.json` with `mounting_class: chassis-fabric` (chassis-fabric overlay), and are referenced from `chassis.supported_ethernet_switch_modules` / `supported_fc_switch_modules`. The sled overlay enumerates the **mezz cards** that connect TO those switches via `mezzanine_slots[]` + `supported_mezzanine_cards[]`; the optional `compatible_switch_modules` field provides the qualified-pairing cross-reference.
- Does not capture cross-chassis fabric topology (Scalable Fabric across MX7000 MCM, Synergy multi-Frame fabric) — that's chassis-scope and lives in `chassis.cross_chassis_management_*` plus the chassis-fabric switch's `supports_fabric_expansion` / `fabric_expansion_max_*` fields.

## Audit notes

### 2026-05-07 — refactor to chassis_membership pattern

Per the cross-overlay analysis (this session), the canonical chassis-resident fields were extracted to `_base.md` so the four overlays expressing the same concept (multi-node, modular-sled, chassis-fabric, deferred liquid-cooled-tray) share one vocabulary. **Field renames from prior version:**

- `sleds_per_chassis_max` → `units_per_chassis_max` (canonical)
- `sled_bay_form_factor` → `bay_form_factor` (canonical)
- `chassis_slot_consumption` → `bay_consumption_count` (canonical)
- `shares_chassis_psu` + `shares_chassis_cooling` → `shares_chassis_power_and_cooling` (collapsed)
- `chassis_form_factor_description` → moved to chassis_membership optional fields in `_base.md`

`independent_sled_bmc` and `chassis_managed_lifecycle` stay as-is (they were already aligned with what's in `_base.md`).

**Field renames don't change extraction values.** Sources don't need re-pulling; re-extraction picks up canonical names. No multi-sled extractions exist on disk yet (MX760c sources pulled, extraction pending in Dell MVP fan-out) so the rename has no migration cost.

### 2026-05-07 — initial drafting

Drafted in advance of the Dell portfolio fan-out. The MX760c cohort (sources pulled, extraction pending) is the validation target. Iterations after the first MX-series extraction wave will refine field set; HPE Synergy iteration deferred to post-MVP.

The fabric-mezzanine model is the load-bearing structural difference from multi-node. Capturing `mezzanine_slots` + `supported_mezzanine_cards` gives downstream consumers a queryable answer to "what fabric does this sled connect to and at what speed" — the analog to a multi-node server's OCP/PCIe NIC catalog. Without these relations, a modular-sled extraction would have empty `## OCP NIC slot capability` and empty `supported_nics` (TOR-facing) and lose the entire networking story. The new optional `compatible_switch_modules` field on `supported_mezzanine_cards` rows closes the qualified-pairing loop with `chassis-fabric` networking products.
