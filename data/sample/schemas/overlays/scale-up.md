---
name: scale-up-overlay
description: Additive overlay on top of server.md for `server_type: scale-up`. Adds NUMA topology, inter-socket interconnect, multi-chassis cabling, partitioning, and mission-critical RAS fields that 4+ socket servers expose and that base server.md doesn't model. Scale-up is defined as `socket_count ≥ 4` (locked 2026-05-04). Examples: Dell R860/R960, HPE DL580 Gen12, DL560 Gen11, Compute Scale-up 3200, Superdome Flex 280; Lenovo SR850/SR860 V3+V4, SR950 V3.
type: schema-overlay
parent: server.md
applies_when: server_type == scale-up
last_updated: 2026-05-06
---

# Scale-up server overlay (additive)

Extends `server.md` for the `scale-up` `server_type`. Every base field still applies. Adds fields that capture inter-socket fabric topology, multi-chassis cabling (some scale-up systems span more than one chassis), hard partitioning, and mission-critical RAS features.

Composition rule: **additive only.** Cannot remove or override base fields.

## Design intent

- **`socket_count ≥ 4` is the discriminator.** 4-socket platforms (Dell R860/R960, DL580 Gen12, SR850/SR860) and 8+-socket platforms (SR950 V3, Compute Scale-up 3200, Superdome Flex 280) all use this overlay. Sub-distinctions are quantitative (number of sockets, partitioning), not categorical.
- **Capture the inter-socket fabric explicitly.** Base server.md treats sockets as opaque; for scale-up the topology and per-socket UPI link count are the load-bearing performance facts.
- **Multi-chassis scale-up is a real shape.** SR950 V3 spans 2× 4U chassis cabled with 8× UPI cables. Compute Scale-up 3200 spans up to 4 chassis. Superdome Flex 280 spans pods. Capture chassis count and interconnect mode.
- **Partitioning is a vendor-specific feature.** Superdome Flex partitions; Lenovo SR950 doesn't. Boolean + max-partitions captures it.
- **RAS features matter for mission-critical workloads.** Memory mirroring, hot-add CPU/memory, lockstep are SAP HANA / Oracle DB / mainframe-replacement requirements.

## Top-level fields

| Field | Type | Required | Notes | Surfaced by |
|---|---|---|---|---|
| `numa_topology` | enum | recommended | `mesh` \| `ring` \| `all-to-all` \| `crossbar` \| `proprietary`. SR950 V3 is mesh; Superdome Flex uses HPE proprietary fabric. Most 4-socket Intel platforms are all-to-all (every CPU has direct UPI links to every other CPU). | SR950 V3, R960, DL580 Gen12 |
| `upi_generation` | string | recommended | `UPI 1.0` (4th-gen Xeon Scalable) \| `UPI 2.0` (5th-gen Xeon Scalable, Xeon 6) \| `UPI 3.0` (Xeon 6+ future) \| vendor-specific (HPE Superdome Flex fabric). Free string — vendor convention varies. | All scale-up platforms |
| `upi_links_per_socket` | integer | recommended | Number of UPI links each socket exposes to the inter-socket fabric. 3 is typical for 4-socket all-to-all; SR950 V3 is 4 (2 intra-chassis + 2 inter-chassis). | All scale-up |
| `upi_speed_gt_s` | number | recommended | UPI link speed in GT/s. UPI 1.0 = 11.2; UPI 2.0 = 16; UPI 3.0 = 24. | All scale-up |
| `max_chassis_count` | integer | yes | Maximum number of physical chassis the scale-up system spans in its largest supported configuration. `1` for single-chassis (R860/R960/DL580/SR850/SR860). `2` for SR950 V3 (8-socket via 2×4U). `4+` for Compute Scale-up 3200, Superdome Flex 280. | All scale-up |
| `chassis_interconnect_type` | enum | conditional | `single-chassis` \| `cabled-upi` \| `cabled-proprietary` \| `integrated-backplane`. Required when `max_chassis_count > 1`. SR950 V3 is `cabled-upi` (8× UPI cables + 2× sideband); Compute Scale-up 3200 is `cabled-proprietary`. `single-chassis` for everything else. | SR950 V3, Compute Scale-up 3200, Superdome Flex 280 |
| `inter_chassis_cable_count` | integer | conditional | Number of cables in a maximum-config inter-chassis topology. Required when `chassis_interconnect_type` is cabled-*. SR950 V3: 8 UPI + 2 sideband = 10 total (or report as primary cable count `8` with sideband in notes). Free-form per vendor convention; capture vendor's stated count. | SR950 V3 |
| `supports_partitions` | boolean | yes | True when the platform supports hard partitioning (BIOS-level; multiple OS instances on one platform). Superdome Flex 280: true. Most 4-socket Intel platforms: false. | Superdome Flex 280 |
| `max_partitions` | integer | conditional | Required when `supports_partitions: true`. Vendor's stated maximum partition count. | Superdome Flex 280 |
| `supports_memory_mirroring` | boolean | recommended | True when the platform supports memory mirroring at BIOS-level (full or per-region). Common on 4-socket+ platforms. | All scale-up |
| `supports_cpu_hot_add` | boolean | recommended | True when CPUs can be added without halting the platform (rare; usually requires partition migration). | Superdome Flex, mainframe-class |
| `supports_memory_hot_add` | boolean | recommended | True when memory DIMMs can be added without halting (vendor + OS support required). | 4-socket+ enterprise platforms |
| `supports_lockstep_memory` | boolean | optional | True when DRAM ECC lockstep mode is supported (slower but higher reliability). | DL580 Gen12, SR950 V3, Superdome Flex |
| `workload_certifications` | list[string] | recommended | Vendor-published mission-critical workload certifications. Common values: `"SAP HANA"`, `"SAP HANA TDI"`, `"Oracle Linux"`, `"Oracle Database"`, `"Microsoft SQL Server"`. Verbatim from vendor's certification matrix. Empty `[]` when none. | All scale-up |
| `min_socket_count_supported` | integer | recommended | Minimum CPU population the platform supports (some 4-socket boards run with 2 CPUs populated). For pure scale-up, this is usually equal to `socket_count` from base; for partial-population platforms it's lower. | R960, DL580 Gen12 |
| `max_chassis_input_power_kw` | number | optional | Maximum chassis input power in kW for the largest supported configuration (sum across chassis when `max_chassis_count > 1`). Useful for data-center power planning. | Superdome Flex 280, Compute Scale-up 3200 |

## Cross-field constraints (verifier-enforced)

1. **`socket_count ≥ 4`** (from base) is mandatory for `server_type: scale-up`. Verifier flags `server_type: scale-up` AND `socket_count < 4` as **fail**.
2. `max_chassis_count = 1` ⇒ `chassis_interconnect_type = single-chassis` (or null).
3. `max_chassis_count > 1` ⇒ `chassis_interconnect_type` MUST be one of `cabled-upi`, `cabled-proprietary`, `integrated-backplane`.
4. `chassis_interconnect_type` is `cabled-*` ⇒ `inter_chassis_cable_count` SHOULD be populated.
5. `supports_partitions: true` ⇒ `max_partitions` MUST be populated and ≥ 2.
6. `supports_partitions: false` ⇒ `max_partitions` MUST be null.
7. `upi_generation` strings should match the platform's `processor_family`. Xeon 6 platforms use UPI 2.0+; 4th-gen Xeon Scalable uses UPI 1.0. Mismatch is **warn**.

## Sub-shapes within the scale-up cohort

Three quantitative tiers worth tagging mentally:

- **4-socket single-chassis** — R860, R960, DL580 Gen12, DL560 Gen11, SR850/SR860 V3+V4. `max_chassis_count: 1`, `supports_partitions: false`, all-to-all UPI topology, UPI 2.0.
- **Multi-chassis 8-socket** — SR950 V3. `max_chassis_count: 2`, `chassis_interconnect_type: cabled-upi`, mesh topology.
- **Mainframe-replacement / partitionable** — Compute Scale-up 3200 (8/16-socket), Superdome Flex 280 (16-socket). `supports_partitions: true`, vendor-proprietary fabric, hot-add CPU/memory.

## Gold-set evidence map

| Overlay field | Surfaced by |
|---|---|
| `numa_topology` | SR950 V3 (mesh, explicit), R960 / DL580 Gen12 (all-to-all, implicit from "fully-meshed UPI" docs), Superdome Flex 280 (proprietary) |
| `upi_generation`, `upi_links_per_socket`, `upi_speed_gt_s` | All scale-up platforms — extract from CPU / interconnect section |
| `max_chassis_count`, `chassis_interconnect_type` | SR950 V3 (2-chassis, cabled-upi), Compute Scale-up 3200 (multi-chassis, cabled-proprietary) |
| `inter_chassis_cable_count` | SR950 V3 (8 UPI + 2 sideband per tech guide) |
| `supports_partitions`, `max_partitions` | Superdome Flex 280 (hard partitions); Compute Scale-up 3200 (check spec) |
| `supports_memory_mirroring`, `supports_cpu_hot_add`, `supports_memory_hot_add`, `supports_lockstep_memory` | DL580 Gen12 (publishes RAS feature list), R960 (Dell tech guide RAS section), SR950 V3 (Lenovo Press LP1729 RAS section) |
| `workload_certifications` | All — extract from vendor's certification statements; SAP HANA TDI is the canonical 4-socket workload |
| `min_socket_count_supported` | R960 (Dell publishes 2-CPU-min config), DL580 Gen12 (HPE QuickSpecs supports 2-CPU operation) |

## Reclassification of existing extractions

Per the locked 2026-05-04 definition (`socket_count ≥ 4` = scale-up), the following currently-extracted products SHOULD reclassify from `general-purpose` to `scale-up` on next refresh:

- Dell: R860, R960
- HPE: DL580 Gen12, DL560 Gen11
- Lenovo: SR850 V3, SR850 V4, SR860 V3, SR860 V4, SR950 V3 (already 8-socket; the V3 4-socket SR-classes flip too)

Existing extractions can stay as `general-purpose` until next refresh; new extractions follow the rule. The viewer's annotation flow can flag the `server_type` field to drive reclassification via spot-fix.

## What this overlay does NOT do

- Does not redefine any base server.md field.
- Does not model the GPU side of scale-up — Superdome Flex with GPUs would compose this overlay PLUS gpu-server overlay (multi-overlay composition is supported per `project_hierarchical_schemas` memory).
- Does not model fault-tolerant lockstep (NonStop) — that's the deferred `fault-tolerant-system` category.
- Does not model in-memory database tuning (HANA-specific tuning) — captured at the `workload_certifications` level, not deeper.

## Audit notes (2026-05-06)

Per `_planning/scale-up-overlay-md-parse-deltas-2026-05-06.md`, the Dell cohort (R860 + R960 with full Reducto MDs) validated the overlay shape — **0 ADDs, 0 REMOVEs**. The notes below capture the cohort's behavioral findings and one verifier-side TIGHTEN.

1. **`socket_count ≥ 4` discriminator holds.** R860 and R960 are unambiguously 4-socket. No Dell ambiguity. All XE-series GPU chassis are dual-socket — correctly excluded.

2. **`numa_topology` is INFERRED, not extracted, from Dell sources.** R860 and R960 tech guides never use the words "topology", "mesh", "all-to-all", or "fully-meshed". The 4-socket all-to-all default is engineering inference at low confidence (~0.85), not a quoted spec. Verifier should not flag inferred values as drift; the field stays `recommended` but extractors mark `confidence ≤ 0.85` and source-silent is acceptable.

3. **`workload_certifications` policy.** R860 and R960 spec sheets carry positioning bullets like "Ideal for: SAP HANA, Oracle, SQL" but do NOT publish a formal certification matrix the way HPE / Lenovo do. Capture from positioning bullets only when the language is "certified for" / "validated for" / "supported"; do not lift from "ideal for" / "designed for" marketing text. (Strict policy — under-extraction is preferable to false-positives in compliance contexts.)

4. **Multi-chassis branch fields untestable in MVP.** `max_chassis_count > 1`, `chassis_interconnect_type` (cabled-upi / cabled-proprietary / integrated-backplane), `inter_chassis_cable_count`, `supports_partitions`, `max_partitions` — all only exercise on Lenovo SR950 V3 / Superdome Flex / Compute Scale-up 3200, all post-MVP. Dell scale-up is single-chassis only. Do not remove the fields — they're additive and cascade to defaults cleanly — but flag them as Dell-MVP-untested.

5. **6 RAS fields silent in Dell tech-guide / spec-sheet axis.** `supports_memory_mirroring`, `supports_cpu_hot_add`, `supports_memory_hot_add`, `supports_lockstep_memory`, `max_chassis_input_power_kw`, plus per-CPU partition/affinity details — all live in Dell BIOS reference / iDRAC datasheet, not in the tech-guide / spec-sheet axis pull-sources fetches today. Cascade to source-silent for Dell scale-up until either (a) `pull-sources` adds a `bios-reference` source type or (b) HPE/Lenovo cohorts surface them in tech-guides.

6. **TIGHTEN — verifier note for memory-cohort partition.** Both R860 and R960 publish `max_memory_gb: 16384` (16 TB; 64 × 256 GB DIMMs) — exactly 2× the GP cohort's 8 TB ceiling. The verifier's >5σ peer-distribution check on `max_memory_gb` will trip false-positive unless the cohort is partitioned by `server_type`. Add to verifier docs: peer cohort selection MUST partition by `server_type` (and ideally also socket-count tier within scale-up for future SR950 V3 / Superdome Flex distinctions).

7. **PROMOTE-TO-BASE candidate (deferred): per-`cpu_skus.upi_speed_gt_s`.** Some 4-socket Intel CPUs ship with derated UPI speeds (e.g. 16 GT/s native, 14.4 GT/s in 4S configurations to maintain power budget). Today the overlay carries a single chassis-level `upi_speed_gt_s` scalar. A per-SKU column would surface the derate. Defer until HPE/Lenovo data confirms the per-SKU split; would also require a base-schema cycle.
