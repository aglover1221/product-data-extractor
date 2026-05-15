---
name: gpu-server-overlay
description: Additive overlay on top of server.md for the gpu-server server_type. Adds GPU-specific fields the base server schema doesn't model — named GPU-baseboard SKUs, SXM/OAM form factors, multi-GPU-vendor diversity, GPU-fabric NIC topology, liquid-cooling readiness, per-chassis sustained power. Authored 2026-05-04 against the 5-product gpu-server gold set: Dell XE9680, HPE DL380a Gen12, HPE XD685, Lenovo SR675 V3, Lenovo SR680a V4.
type: schema-overlay
parent: server.md
applies_when: server_type == gpu-server
last_updated: 2026-05-06
---

<!-- 2026-05-06 audit pass (per `_planning/gpu-server-overlay-md-parse-deltas-2026-05-06.md`) — 10 in-scope Dell PowerEdge gpu-server SKUs validated against the new Reducto MDs:
- ADD: `sxm4` to `gpu_baseboards.gpu_form_factor` enum (XE9680 / XE9780 A100 SXM4 SKUs)
- TIGHTEN: `fabric_nics.gpu_pairing_ratio` semantics — strike "1:1" inference (XE9680L/XE9685L max-config = 12 NICs : 8 GPUs)
- CLARIFY: `liquid_cooling_required` = ALL configs (not ANY); XE9680L H200-SXM5+B200-SXM6 mixed = `false` (B200 is optional DLC), `liquid_cooling_optional` carries the DLC-availability axis
- CLARIFY: `liquid_cooling_type: hybrid-l2a` covers Dell LAAC (Liquid-Assisted Air Cooling, GFB) — vendor-naming difference, same architecture
- CLARIFY: `pcie_switch_board_count` is max-across-configs; per-SKU board details (XE9785's PSBB-for-MI355X vs PSRBB-for-B300) belong in `gpu_baseboards.notes`
- DEFER (vendor_extensions for now): IR5000/IR7000 rack-required (XE9680L, XE9780); promote to base when ≥ 2 vendors expose -->

# GPU Server Overlay

Additive overlay on `server.md`. When `server_type: gpu-server`, the overlay's fields layer onto the base extraction. The overlay never overrides or removes a base field — only adds new fields and extends two enums (`gpu_form_factor_support.form_factor`, `supported_gpus.form_factor`). A base-only general-purpose extraction is a valid subset of any gpu-server extraction.

The fields here exist because the base schema doesn't capture concepts that show up across the gpu-server gold set: named SXM/OAM baseboard SKUs, multi-generation GPU swap support in one chassis, dedicated east-west fabric NICs, GPU-form-factor variety beyond PCIe, and the cooling/power envelope shifts that come with 700–1,400 W per-GPU TDPs.

## Composition rules

- Every field in `server.md` continues to apply when this overlay is composed.
- Where this overlay extends an existing base enum (e.g. adds `sxm` and `oam` to `gpu_form_factor_support.form_factor`), an extracted gpu-server value MAY use the broadened enum; a base-only general-purpose extraction MUST stay within the narrower enum.
- This overlay does NOT redefine `supports_gpu`, `supports_pcie_gpu`, `supports_double_width_gpu`, `max_gpu_power_w`, or `gpu_form_factor_support` — those remain as defined in base. PCIe-GPU information for gpu-server chassis (DL380a Gen12, SR675 V3) populates the base relations exactly as it would for a general-purpose server.

## Extended enums

| Base relation | Base enum | Overlay extension |
|---|---|---|
| `gpu_form_factor_support.form_factor` | `single-width` \| `double-width` | + `sxm` \| `oam` |
| `supported_gpus.form_factor` | `single-width` \| `double-width` | + `sxm` \| `oam` |

## Top-level fields

| Field | Type | Required | Notes | Surfaced by |
|---|---|---|---|---|
| `primary_gpu_form_factor` | enum | yes | `sxm` \| `oam` \| `pcie-double-wide` \| `pcie-single-wide`. The chassis's primary GPU mounting style. PCIe-GPU-dense chassis (DL380a Gen12, SR675 V3 8-DW model) use `pcie-double-wide`; SXM-baseboard hosts (XE9680, SR680a V4) use `sxm`; OAM-baseboard hosts (XD685, XE9680 Gaudi3 / MI300X variants) use `oam`. When a chassis SKU spans multiple primary forms (XE9680 sells both SXM and OAM baseboards), pick the form most-shipped or the one the spec sheet leads with — the full set is enumerated in `gpu_baseboards`. | XE9680 (SXM/OAM), DL380a Gen12 (PCIe DW), XD685 (OAM), SR675 V3 (SXM + PCIe DW), SR680a V4 (SXM) |
| `gpu_chassis_class` | enum | recommended | `baseboard-host` \| `pcie-gpu-dense` \| `pcie-gpu-light`. `baseboard-host` is "8-GPU SXM/OAM baseboard chassis"; `pcie-gpu-dense` is "≥6 PCIe GPUs in 4U+ chassis"; `pcie-gpu-light` is "≤2 PCIe GPUs as an option in a general 1U/2U" (these are general-purpose, not gpu-server, but the field exists for verifier sanity-checks). | All gold-set members |
| `liquid_cooling_required` | boolean | yes | True when the chassis cannot be operated air-cooled in **any** supported configuration (i.e., every supported `gpu_baseboards` row has `requires_dlc: true`). False whenever any air-supported config exists, even if some baseboards within the same chassis SKU require DLC — the chassis itself is then `false` here and the per-SKU constraint is captured on the `gpu_baseboards.requires_dlc` row. (Semantics tightened 2026-05-06: previous wording "True when the chassis or GPU SKU requires DLC" was ambiguous on multi-baseboard chassis. XE9680L = `false` because H200-SXM5 air-cooled config exists alongside B200-SXM6 DLC-required; XE9685L B200-only SKU = `true`; XD685 B300-only SKU = `true`.) Pair with `liquid_cooling_optional` for the "DLC variant available" axis. | XD685 B300-only SKU (true), XE9685L (true — DLC across all configs), XE9640 (true), XE9680L (false — mixed), XE9680 (false, air), XE9785 (false — air for MI355X, DLC optional for B300) |
| `liquid_cooling_optional` | boolean | yes | True when the chassis offers an optional DLC variant (separate SKU or upgrade) AND `liquid_cooling_required: false`. Captures the "DLC-ready" axis distinct from required DLC. | XD685 (true — air and DLC chassis SKUs both offered), SR675 V3 (true — Neptune L2A is an option), XE9785 (true — B300 DLC optional alongside MI355X air), R760xa (true — partial-DLC for select 350W CPUs), XE8640 (true — LAAC GPU cooler, see `liquid_cooling_type`) |
| `liquid_cooling_type` | enum | recommended when liquid_cooling_optional or liquid_cooling_required | `cold-plate-dlc` \| `hybrid-l2a` \| `rear-door-hx` \| `immersion`. `hybrid-l2a` covers any closed-loop liquid GPU cooler with air heat-rejection at chassis (no facility-water hookup) regardless of vendor name — Lenovo Neptune L2A AND **Dell LAAC (Liquid-Assisted Air Cooling, GFB = Glycol Fan Block)** map to the same enum value. Capture the verbatim vendor term in `vendor_extensions` if needed. `cold-plate-dlc` is full facility-water DLC (XD685 DLC SKU, XE9640, XE9685L, XE9680L). | XD685 DLC (cold-plate-dlc), XE9640 / XE9685L / XE9680L (cold-plate-dlc), SR675 V3 (hybrid-l2a), XE8640 (hybrid-l2a — LAAC), XE9785 B300 (cold-plate-dlc) |
| `pcie_switch_board_count` | integer | optional | Number of PCIe switch boards in the chassis (PBB / retimer / repeater fabric used to fan out CPU PCIe lanes for higher GPU count or 1:1 NIC-per-GPU topology). 0 = no switchboard (R760xa direct CPU PCIe). 1 = single switchboard (XE9680 PBB, SR680a V4 on-board fabric). ≥ 2 captures multi-switchboard chassis (HPE DL380a Gen12 ships with up to 4 in the upgrade kit). Switch-board vendor names live in source `.md` sidecars, not the structured layer. **When the chassis supports multiple GPU baseboards using physically distinct switch boards** (e.g. XE9785 ships PSBB for the AMD MI355X 12-slot config and PSRBB for the NVIDIA B300 4-slot config — both count=1 but they're different parts), the integer is the maximum across all configs and per-SKU board details belong in `gpu_baseboards.notes`. | XE9680 (1, "PBB"), XE9785 (1 — PSBB or PSRBB by SKU), DL380a Gen12 (1–4 depending on kit), SR680a V4 (1 on-board), R760xa (0) |

## Per-GPU-baseboard table (`gpu_baseboards`)

One row per supported GPU baseboard SKU. A single chassis SKU often supports multiple baseboards across generations (SR680a V4: B300 + B200 + H200 + H100; XE9680: H100/H200 + H20 + A100 + MI300X + Gaudi3). PCIe-GPU-only chassis (DL380a Gen12) leave this relation empty.

| Field | Type | Required | Notes |
|---|---|---|---|
| `baseboard_sku` | string | yes | Vendor's verbatim baseboard product name. Examples (quote exactly): "ThinkSystem NVIDIA HGX B300 NVL8 1100W 8-GPU Board", "ThinkSystem NVIDIA HGX H200 141GB 700W 8-GPU Board", "NVIDIA HGX H100/H200 8-GPU SXM5", "AMD INSTINCT MI300X 8-GPU OAM 2.0", "Intel Gaudi3 8-GPU OAM 2.0", "NVIDIA HGX B300 288GB 8-GPU Direct Liquid Cooling FIO Accelerator". Free text — vendor naming is wildly inconsistent. |
| `gpu_vendor` | enum | yes | `NVIDIA` \| `AMD` \| `Intel`. |
| `gpu_model` | string | yes | "H100", "H200", "B200", "B300", "MI300X", "MI325X", "MI355X", "Gaudi3". Versioned model name without baseboard-form suffix. |
| `gpu_generation` | string | recommended | "Hopper", "Blackwell", "Ada Lovelace", "MI300", "Gaudi3". Vendor architecture label. |
| `gpu_count` | integer | yes | GPUs on the baseboard. Most are 8; older Hopper variants offered 4-GPU subsets. |
| `gpu_form_factor` | enum | yes | `sxm` \| `sxm4` \| `sxm5` \| `sxm6` \| `oam` \| `oam-2.0`. Use the most-specific form when the doc surfaces it (A100 baseboards are SXM4; H100/H200 are SXM5; B200/B300 are SXM6). `sxm4` added 2026-05-06 per XE9680 / XE9780 A100 SXM4 SKU evidence. |
| `per_gpu_tdp_w` | integer | yes | Per-GPU TDP at chassis-supported sustained power. 700 (H100/H200), 1000 (B200), 1100 (B300 air-cooled), 1400 (B300 DLC), 750 (MI300X), 900 (Gaudi3). |
| `gpu_memory_gb` | integer | recommended | Per-GPU HBM (HBM3, HBM3e, HBM4). 80 (H100), 141 (H200), 192 (MI300X / B200), 270 (B300), 288 (XD685 B300 / MI355X variants). |
| `nvlink_generation` | string | recommended | "NVLink 3" (A100), "NVLink 4" (H100/H200/B200), "NVLink 5" (B300). Empty for non-NVIDIA boards. |
| `nvlink_total_bandwidth_gb_s` | number | recommended | Aggregate per-GPU NVLink bandwidth. 900 (H100/H200), 1800 (B100/B200/B300). Empty for non-NVIDIA. |
| `has_onboard_nvswitch` | boolean | recommended | True when the baseboard ships an integrated NVSwitch fabric (HGX 8-GPU baseboards do). False for non-NVIDIA OAM. Empty for PCIe-only platforms. |
| `requires_dlc` | boolean | yes | True when this baseboard SKU is sold only with DLC. Drives the chassis-level `liquid_cooling_required` flag when at least one supported baseboard requires DLC. |
| `available_at_launch` | boolean | optional | False for roadmap baseboards (B300 was post-launch on some chassis). |
| `notes` | string | optional | Per-baseboard caveats verbatim from source. |

## Fabric NIC topology — `fabric_nics`

Distinct from base's `## Networking` (LOM + OCP NICs + PCIe add-in NICs at all speeds, per `feedback_pcie_nics_are_general` memory). This relation captures the dedicated east-west GPU fabric: high-speed (≥200 Gbps) NICs whose role is GPU-to-GPU traffic between hosts, often in a 1:1-with-GPUs ratio and frequently embedded on the GPU baseboard or its mezzanine.

The relation is gpu-server-specific. PCIe-GPU-dense chassis (DL380a Gen12) without a dedicated GPU fabric leave it empty and rely on base's `## Networking` only.

| Field | Type | Required | Notes |
|---|---|---|---|
| `nic_model` | string | yes | "ConnectX-7", "ConnectX-8", "BlueField-3 B3220", "BlueField-3 B3140H". Verbatim. |
| `nic_count` | integer | yes | Number of fabric NICs in the max-config chassis. SR680a V4: 8 (1:1 with 8 GPUs). SR675 V3 SXM: 4 (1:1 with 4 SXM5 GPUs). |
| `port_speed_gbps` | integer | yes | Per-port headline speed. 200 (NDR200), 400 (NDR), 800 (ConnectX-8). |
| `port_count_per_nic` | integer | recommended | 1 or 2 typically. |
| `port_type` | string | recommended | "OSFP", "QSFP112", "QSFP-DD". |
| `mounting` | enum | yes | `onboard` \| `mezzanine` \| `pcie-slot`. Onboard means soldered to chassis (SR680a V4 ConnectX-8). Mezzanine means a dedicated GPU-fabric mezzanine card carrying multiple NICs (SR675 V3 SXM5 I/O mezz with 4× ConnectX-7). PCIe-slot is the same NIC living in a regular PCIe slot. |
| `gpu_pairing_ratio` | string | recommended | Free string. Capture the **max-config NIC count vs GPU count**, NOT a design-intent ratio. "1:1" (one NIC per GPU — XE9680 ConnectX-7 case), "1.5:1" or "12:8" (over-subscribed fabric — XE9680L / XE9685L max-config = 12 NDR400 NICs against 8 GPUs), "1:2" (under-subscribed), "shared" (NIC ports span multiple GPUs). (Semantics tightened 2026-05-06: gold-set "1:1" inference was wrong at scale across the broader Dell cohort.) |
| `supports_gpu_direct` | boolean | recommended | True for NICs that advertise GPUDirect / RDMA-to-GPU support. |
| `notes` | string | optional | Verbatim caveats. |

## Multi-generation GPU support (informational, derived)

The verifier (not the extractor) computes this from `gpu_baseboards` rows. When `gpu_baseboards` contains baseboards spanning ≥2 GPU generations on the same chassis SKU (e.g. SR680a V4: H100 + H200 + B200 + B300), the chassis is multi-gen-swappable. No dedicated field is required — the relation rows are the source of truth.

## Provenance

Every field above carries the standard `evidence` object defined in `server.md` (`source`, `anchor`, `quote`, `confidence`). For tables (`gpu_baseboards`, `fabric_nics`), `evidence` attaches at the row level.

When a gold-set sidecar surfaces a baseboard SKU but does not state per-GPU TDP or NVLink bandwidth, mark those fields `null` with `evidence: source-silent` rather than inferring from datasheet conventions. The verifier treats source-silent as different from "extractor missed it" — see base schema's "Tolerate missing data, mark it" rule.

## What this overlay does NOT capture

- **NVSwitch ASIC count, NVSwitch generation, internal NVLink topology diagrams** — fabric topology beyond aggregate bandwidth is doc-narrative territory; lives in source `.md` sidecars, not structured.
- **AMD Infinity Fabric / xGMI bandwidth** — gold-set docs (XE9680 MI300X, XD685 MI355X) don't surface this. Add when a future MI-platform doc includes it.
- **Per-GPU memory bandwidth (HBM TB/s)** — interesting but absent from chassis spec sheets; lives in GPU vendor datasheets, not server docs.
- **GPU performance metrics (TFLOPS, sparse vs dense)** — chassis docs cite these inconsistently; out of scope.
- **Inter-chassis fabric topology** (Spectrum-X, NVL72 rack composition) — that's a rack/cluster-level concern, not a per-server field.

When a GPU-server query needs any of the above, fall back to the source `.md` sidecars.

## Gold-set evidence map

| Overlay field | Surfaced by (gold set) |
|---|---|
| `primary_gpu_form_factor` | All 5 |
| `gpu_chassis_class` | All 5 (verifier-derived, but extractor sets) |
| `liquid_cooling_required` | XD685 (B300 SKU only) |
| `liquid_cooling_optional` | XD685, SR675 V3 |
| `liquid_cooling_type` | XD685 (cold-plate-dlc), SR675 V3 (hybrid-l2a) |
| `pcie_switch_board_count` | XE9680 (PBB ×1), DL380a Gen12 (up to 4 with kit), SR680a V4 (×1 on-board) |
| `gpu_baseboards` | XE9680, XD685, SR675 V3 (SXM model), SR680a V4 |
| `fabric_nics` | XE9680, SR675 V3, SR680a V4; null for DL380a Gen12, XD685 (gold-set docs silent) |
