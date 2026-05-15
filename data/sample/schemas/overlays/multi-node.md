---
name: multi-node-overlay
description: Additive overlay on top of server.md for `server_type: multi-node`. Composes the chassis_membership pattern from `_base.md` and adds multi-node-specific fields (independent-BMC architecture, optional inter-node interconnect, mixed-model rules) for compute nodes that fit in a multi-node-dense chassis (Dell PowerEdge C6600, Lenovo ThinkSystem D3, HPE Cray XD2000). Examples: Dell C6615 / C6620; Lenovo SD530 V3 / SD550 V3 / SD520 V4 / SD535 V3; HPE Cray XD220v / XD225v / XD295v / XD665.
type: schema-overlay
parent: server.md
applies_when: server_type == multi-node
last_updated: 2026-05-07
---

# Multi-node server overlay (additive)

Extends `server.md` for the `multi-node` `server_type`. Multi-node servers are compute nodes that physically share a chassis with other nodes — sharing power, cooling, and frequently a backplane — but each node carries its own CPU, memory, storage, NIC, and BMC. The chassis is purely mechanical density; no integrated fabric switches and (typically) no chassis-resident management plane.

Distinct from `modular-sled` (which fits in a *bladed* chassis with integrated fabric switches AND chassis-managed lifecycle).

Composition rule: **additive only.** Cannot remove or override base fields.

## Design intent

- **Composes the `chassis_membership` pattern** from `_base.md`. The eight canonical chassis-resident fields (`installs_in_chassis_slug`, `installs_in_chassis_vendor`, `host_chassis_type`, `bay_form_factor`, `bay_consumption_count`, `units_per_chassis_max`, `shares_chassis_power_and_cooling`, `chassis_managed_lifecycle`) are populated identically across multi-node, modular-sled, and chassis-fabric overlays. Field semantics are documented once in `_base.md`.
- **The structural discriminator vs `modular-sled` is `chassis_managed_lifecycle: false`.** Multi-node nodes have independent BMCs and are NOT orchestrated by a chassis MM. Each node is operationally a standalone server; the chassis just provides power and cooling.
- **No integrated chassis fabric.** Networking is per-node via OCP / PCIe NICs to top-of-rack — base server.md's `## OCP NIC slot capability` and `## Supported NICs` are populated normally, exactly as they would be for a standalone rack server. (Modular-sled is the opposite case: chassis-fabric mezzanine cards replace TOR-facing NICs.)
- **Shared resources are chassis-scope.** Base `psu_count_max`, `max_psu_output_w`, `fan_count_max` capture chassis-level values on a multi-node node — each node sees the chassis's PSU envelope. Document this in `evidence.notes` when the source attribution makes it ambiguous.

## Top-level fields

| Field | Type | Required | Notes | Surfaced by |
|---|---|---|---|---|
| (composes chassis_membership pattern — see `_base.md`) | — | — | All 8 canonical fields populated. `host_chassis_type` is always `multi-node-dense`. `chassis_managed_lifecycle` is always `false` (the discriminator vs modular-sled). `shares_chassis_power_and_cooling` is always `true`. `bay_form_factor` is one of `1u-half-width-sled` / `2u-half-width-sled` / `1u-full-width-sled` / `1u-quarter-width-sled` / `proprietary`. | All multi-node |
| `node_position_count` | integer | recommended | For chassis with numbered positions (D3 has 4 positions: top-left/top-right/bottom-left/bottom-right). Captures the count, not the per-position semantics. Distinct from `units_per_chassis_max` — node_position_count describes the chassis's slot map; units_per_chassis_max describes how many of THIS specific node model fit. They're typically equal for homogeneous-node chassis. | Lenovo SD-class, HPE Cray XD |
| `inter_node_interconnect` | enum | optional | `none` \| `pcie-direct` \| `nvlink` \| `proprietary`. Most multi-node chassis are `none` (each node networks through TOR independently). HPE Cray XD nodes can have proprietary inter-node fabric for HPC. | Cray XD-class |
| `mixed_node_models_in_chassis` | boolean | optional | True when the chassis can host different node models simultaneously (e.g. mixing SD530 V3 and SD550 V3 in one D3). False when the chassis must be populated with identical nodes. **Note:** richer rules ("V3 and V4 cannot mix"; "1P-only or 2P-only") belong in `chassis.compute_unit_mixing_constraints` on the chassis side, not here. This boolean is the simple yes/no signal. | Lenovo D3 (true for some configs) |

## Subarrays — none specific to multi-node

The overlay does not add any list-of-rows relations. All the per-CPU-SKU, DIMM, PCIe slot, etc. tables are populated identically to base `server.md` (each node carries its own).

## Cross-field constraints (verifier-enforced)

The chassis_membership pattern's universal constraints from `_base.md` apply. Multi-node-specific constraints:

1. **`host_chassis_type` MUST equal `multi-node-dense`.** A multi-node node in a bladed or liquid-cooled-rack chassis is a category mismatch — fail.
2. **`chassis_managed_lifecycle` MUST equal `false`.** Multi-node by definition means each node has independent BMC; if mgmt is centralized, the product belongs in `modular-sled`. Fail.
3. **`units_per_chassis_max ≥ 2`.** A 1-node-per-chassis product isn't multi-node — fail.
4. **`shares_chassis_power_and_cooling` MUST equal `true`.** A node that doesn't share chassis PSU+fans isn't a multi-node node — fail.

## Distinctions vs adjacent server_types

- **vs `modular-sled`** (active): modular-sled installs in a *bladed* chassis (MX7000, Synergy 12000) with integrated fabric switches AND a chassis-wide management plane. The structural difference: `host_chassis_type: bladed` and `chassis_managed_lifecycle: true`, plus the modular-sled-specific `mezzanine_slots[]` and `supported_mezzanine_cards[]` relations.
- **vs `liquid-cooled-tray`** (deferred): liquid-cooled-tray is multi-node-style architecturally but specifically for `liquid-cooled-rack` chassis (N1380). When that overlay ships, it composes the chassis_membership pattern + DLC-specific fields; the discriminator vs multi-node is `host_chassis_type: liquid-cooled-rack`.
- **vs `general-purpose`**: general-purpose is a standalone rack/tower; multi-node is a node that doesn't function without its chassis (`requires_chassis_to_operate: true`).

## Sub-shapes within the multi-node cohort

- **Air-cooled multi-node-dense (mainstream)** — Dell C6600 (C6615, C6620), Lenovo D3 (SD530/SD550 V3, SD520/SD535 V4), HPE Cray XD2000 (XD220v / XD225v / XD295v). 2U 4-sled or 2U dual-density layouts.
- **High-density HPC multi-node** — HPE Cray XD nodes specifically; some support inter-node fabric (Slingshot in deeper Cray-XD configs, less so in XD2000). `inter_node_interconnect: proprietary`.
- **Edge multi-node** — Dell XR8000r (rugged sled-based, 2U-up-to-4-nodes, environmental envelope captured via base `ashrae_class_max: rugged` + edge-overlay-validated `environmental_class_labels`). Composes multi-node + edge overlays simultaneously.

## Gold-set evidence map

| Overlay field | Surfaced by |
|---|---|
| chassis_membership 8 canonical fields | All multi-node — extract from spec sheet's "Chassis required" section + tech guide's chassis-internals figure. `bay_form_factor` from chassis-internals diagram (e.g. C6600 shows 2W×2H sled arrangement → `1u-half-width-sled`). |
| `node_position_count` | D3 publishes 4 numbered positions; Cray XD2000 publishes 4. Dell C6600 implicit (4 sleds, no named positions). |
| `inter_node_interconnect` | Cray XD platforms when configured for HPC. |
| `mixed_node_models_in_chassis` | Lenovo D3 (publishes mixing rules in tech guide). |

## Reclassification of existing extractions

The following Dell products carry `server_type: multi-node` and reference `installs_in_chassis_slug: c6600`: C6615, C6620, XR8000r (rugged multi-node; also composes edge overlay). HS5610 and HS5620 are NOT multi-node despite "Hyperscale Next" branding — they are standalone 2-socket rack servers (E87S / E88S regulatory models, own chassis dimensions / PSUs / rails) and carry `server_type: general-purpose`.

Lenovo SD-prefix and HPE Cray XD nodes are discoverable in `server/_discovery/lenovo-servers-2026-05-04.md` and `server/_discovery/hpe-servers-2026-05-04.md` respectively, deferred to post-MVP.

## What this overlay does NOT do

- Does not redefine any base server.md field.
- Does not redefine the chassis_membership pattern fields — they live in `_base.md`.
- Does not duplicate the chassis spec — chassis lives under `chassis/{vendor}/...` and is referenced by slug.
- Does not model bladed chassis sleds — that's the `modular-sled` overlay.
- Does not model liquid-cooled trays — that's the deferred `liquid-cooled-tray` overlay (will compose chassis_membership + DLC-specific fields).
- Does not capture inter-chassis topology — multi-chassis scale-out (Cray XD with Slingshot fabric, etc.) is bigger-picture and out of pilot scope.
- Does not model multi-sled mixing rules beyond a coarse boolean — richer rules ("homogeneous 1P or 2P only", "V3-only no V4 mixing") live on the chassis side in `chassis.compute_unit_mixing_constraints`.

## Audit notes

### 2026-05-07 — refactor to chassis_membership pattern

Per the cross-overlay analysis (this session), the canonical chassis-resident fields were extracted to `_base.md` so the four overlays expressing the same concept (multi-node, modular-sled, chassis-fabric, deferred liquid-cooled-tray) share one vocabulary. **Field renames from prior version:**

- `nodes_per_chassis_max` → `units_per_chassis_max` (canonical — same value for compute-node residents)
- `node_bay_form_factor` → `bay_form_factor` (canonical — same enum, same values)
- `shares_chassis_psu` + `shares_chassis_cooling` → `shares_chassis_power_and_cooling` (collapsed into one boolean; the two were perfectly correlated across cohort)
- `independent_node_management` (true) → `chassis_managed_lifecycle` (false) (semantic inversion to align with bladed-side overlays where the boolean reads positively; same architectural fact captured)
- `chassis_is_separate_product` → **deprecated.** Always true now (Dell C6600 was the last implicit-chassis case; staged 2026-05-07). Old extractions with `chassis_is_separate_product: false` are invalid; re-extract.
- `chassis_form_factor_description` → moved to chassis_membership optional fields in `_base.md`.

**Field renames don't change extraction values for the existing 2 multi-node extractions (C6620, C6615 if extracted).** Re-extraction picks up the canonical names automatically since the semantics are unchanged. `independent_node_management` is the one inversion — re-extractor must flip the boolean and rename.

### 2026-05-06 — cohort findings (Dell C-series)

Per `_planning/multi-node-overlay-md-parse-deltas-2026-05-06.md`, the Dell C-series cohort (C6600 + C6615 + C6620 — all with full Reducto MDs; C6600 directory mirrors the C6620 tech-guide because Dell publishes one combined "C6600 + sled" PDF) validated the overlay's pattern fit — **0 ADDs, 0 REMOVEs**. Cohort findings:

1. **`bay_form_factor` for C-series.** Pre-Reducto baseline extractions emitted `1u-full-width-sled` for c6620 — wrong. The C6600 chassis is 448 mm wide (2U) and holds 4 sleds arranged 2-wide × 2-high, each sled 174.4 mm × 40 mm. Correct value is **`1u-half-width-sled`**. The Reducto-driven re-extraction picks up the right value automatically.

2. **Mixed-sled rule belongs on the chassis side.** Dell publishes: "Mixed sled restriction: Only homogeneous 1P sleds or homogeneous 2P sleds can be supported" (XR8000r tech guide; similar text in C6600). The boolean `mixed_node_models_in_chassis` is too coarse — capture the rule verbatim in `chassis.compute_unit_mixing_constraints` (chassis schema v1.1 supports). Don't widen the boolean.

3. **`weight_kg` published inconsistently.** Dell publishes per-sled (c6615: 3.7 kg) or per-chassis-fully-populated (c6620: 42.5 kg). Extractors capture verbatim per source convention and add a `notes: "per-sled"` or `notes: "per-chassis fully populated"` qualifier. Do NOT introduce `weight_scope` field machinery; the source-authoritative quote in `evidence` is enough.

4. **`units_per_chassis_max` keep as data field.** Uniformly 4 across Dell C-series. Lenovo D3 and HPE Cray XD chassis sizes vary — keep extracting per-product.

5. **C6600 chassis staged 2026-05-07 (resolved).** Chassis schema v1.1 supports `chassis_type: multi-node-dense` with `shared_management_model: none`, modeling C6600 cleanly. Chassis directory created at `chassis/dell/poweredge/c6600/` with hardlinked tech-guide sources. C6620 / C6615 nodes carry `installs_in_chassis_slug: c6600`.

6. **Reclassification cohort.** C6600, C6615, C6620, XR8000r carry `server_type: multi-node`. HS5610/HS5620 are standalone 2-socket rack servers (general-purpose) — see § "Reclassification list" above.
