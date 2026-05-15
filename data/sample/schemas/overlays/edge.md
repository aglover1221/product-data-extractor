---
name: edge-overlay
description: Additive overlay on top of server.md for `server_type: edge`. Adds ruggedization, environmental, certification, and mounting fields that ship-anywhere edge servers expose and that base server.md doesn't model. Examples: Dell XR-series (XR5610, XR7620, XR8000r, XR8610t, XR8620t, XR8720t), HPE Edgeline + ProLiant EL, Lenovo ThinkEdge SE.
type: schema-overlay
parent: server.md
applies_when: server_type == edge
last_updated: 2026-05-06
---

<!-- 2026-05-06 audit pass #2 (per `_planning/edge-overlay-md-parse-deltas-2026-05-06.md`) — all 6 Dell XR products with full Reducto MDs validated:
- TIGHTEN: drop `level-1` from `nebs_compliance_level` enum (0/6 use it; only level-3 or none)
- TIGHTEN: demote `conformal_coating_option` recommended → optional (0/6)
- ADD: `environmental_class_labels` (verbatim cert label list — `ashrae_class_max` collapse is lossy)
- REMOVE: `extended_ambient` (mechanically derivable from `ashrae_class_max != A2`)
- CLARIFY: 4 gold-set evidence-map fixes (XR8620t "Class 1" was NEBS GR-3108 not IEC; XR5610 has MIL-STD-901E; mounting "vehicle" never surfaces; PSU example value naming) -->

# Edge server overlay (additive)

This overlay extends `server.md` for the `edge` `server_type`. Every base field still applies and is populated identically. The overlay adds fields that capture the ruggedization, environmental tolerance, and deployment-flexibility concepts edge platforms expose and that don't apply (or apply uniformly) to mainstream rack servers.

Composition rule: **additive only.** Overlay cannot remove or override base fields. It can add new fields and tighten enums (none required at this time).

## Design intent

- **Capture environmental envelope as ranges, not single values.** Operating temp min/max moved to base `## Environmental` (2026-05-06) since every server has them; this overlay extends with humidity, altitude, and the `extended_ambient` brief-excursion flag. The buyer-decision question is "can I deploy this in my factory floor / cell tower / vehicle?"
- **Use vendor-published certification tags verbatim.** MIL-STD, NEBS, IP, hazardous-location certs are normalized strings — extracting verbatim preserves provenance for compliance audits.
- **Don't over-model the form factor.** Most edge servers are short-depth (<= 500mm) and may be fanless. Capture as boolean flags and keep depth in base `depth_mm`.
- **DC power options matter at edge.** Many edge servers offer 12V/24V/48V DC input on top of (or instead of) AC. Base `dc_power_supported: boolean` is a yes/no; this overlay adds the voltage list.
- **Mounting flexibility is a discriminator.** A vehicle-mountable rugged server is a different product than a wall-mount edge gateway. Capture mounting options.

## Top-level fields

> Note: `operating_temp_min_c` and `operating_temp_max_c` moved to base `server.md ## Environmental` on 2026-05-06 (every server has them). They continue to apply on edge extractions — populated from base, not the overlay. `extended_ambient` was removed from this overlay 2026-05-06 audit pass #2 — it was mechanically derivable from `ashrae_class_max != A2` (cross-field constraint that was already in this file). Use that derivation; verbatim cert labels are now captured by `environmental_class_labels` below.

| Field | Type | Required | Notes | Surfaced by |
|---|---|---|---|---|
| `environmental_class_labels` | list[string] | recommended | Verbatim list of vendor-published environmental categories from the tech-guide line "operates in these environmental categories: …". Captures cert detail that `ashrae_class_max` collapses lossily. Examples: `["ASHRAE A2", "ASHRAE A3", "ASHRAE A4", "Edge1", "Edge2"]` (XR5610/XR7620), `["ASHRAE A2", "NEBS3", "GR3108C1+", "GR3108C1-L", "NEBS3-H"]` (XR8620t / XR8000 family). Downstream consumers asking "which XR meets GR-3108 outside-plant?" answer from this list, not from the collapsed enum. | All XR (6/6 in 2026-05-06 audit) |
| `operating_humidity_min_pct` | number | optional | RH%, non-condensing min. | XR-series |
| `operating_humidity_max_pct` | number | optional | RH%, non-condensing max. | XR-series |
| `operating_altitude_max_m` | integer | recommended | Max operating altitude in meters. Edge servers often ship to 5000m+ (vs mainstream 3000m). | XR-series |
| `shock_resistance_g` | number | optional | Operating shock resistance in g-force. Vendor convention varies — capture verbatim with units in `shock_resistance_notes` if present. | XR-series, ThinkEdge |
| `vibration_resistance_grms` | number | optional | Operating random vibration in g RMS. | XR-series, ThinkEdge |
| `mil_std_810_methods` | list[string] | optional | Verbatim MIL-STD-810 method tags the platform claims (e.g. `["Method 514.8 Procedure I", "Method 516.8 Procedure I"]`). Empty list `[]` when not certified. | XR-series, ThinkEdge SE |
| `mil_std_901_certified` | boolean | optional | True when platform claims MIL-STD-901 (shipboard shock). Rare; XR-series does not, some specialized edge variants do. | (none in pilot) |
| `nebs_compliance_level` | enum | optional | `none` \| `level-3`. Telecom-grade NEBS Level 3 is the headline cert for cell-tower / central-office deployments. (`level-1` was in the enum until 2026-05-06; dropped — 0/6 Dell XR products surface it; the binary in practice is `none` vs `level-3`. Re-add via overlay versioning if a non-Dell vendor surfaces it.) | XR-series, Edgeline |
| `ip_rating` | string | optional | Ingress Protection rating (`IP55`, `IP65`, `IPX5`). Verbatim string; empty when not rated. | XR-series, ThinkEdge SE |
| `hazardous_location_certs` | list[string] | optional | Verbatim haz-loc certs the platform claims (e.g. `["Class I Div 2", "ATEX Zone 2"]`). Required for oil-and-gas / chemical / mining deployments. | XR-series |
| `conformal_coating_option` | boolean | optional | True when the chassis offers a conformal-coated PCB option for humid/corrosive environments. Demoted recommended → optional 2026-05-06 (0/6 Dell XR products publish a coated-PCB SKU; ThinkEdge SE is post-MVP). | ThinkEdge SE (post-MVP) |
| `filtered_air_intake` | boolean | optional | True when the chassis ships with or supports a dust filter on air intake. | XR-series |
| `fanless_variant_available` | boolean | recommended | True when a fanless chassis SKU exists. Most ThinkEdge SE entry models are fanless; XR series is not. | ThinkEdge SE |
| `short_depth_chassis` | boolean | yes | True when chassis depth ≤ 500 mm (typical telco-rack / wall-mount constraint). Verifier cross-check: `short_depth_chassis: true` ⇒ `depth_mm ≤ 500` (in base). | XR-series (most) |
| `mounting_options` | list[enum] | recommended | Subset of `rack` \| `wall` \| `din-rail` \| `vehicle` \| `ceiling` \| `desktop`. XR-series typically supports `[rack, wall]`; XR8000r adds `vehicle` (military variant). | XR-series, ThinkEdge SE |
| `dc_power_voltages` | list[number] | optional | DC input voltages supported when `dc_power_supported` (base) is true. Common: `[12, 24, 48]` or `[-48]` for telecom. Empty `[]` when only AC. | XR-series |
| `dc_power_input_options` | list[string] | optional | Verbatim PSU connector descriptions (`"-48VDC barrel"`, `"24VDC terminal block"`). Free-text — vendor convention. | XR-series, Edgeline |

## Cross-field constraints (verifier-enforced)

1. `nebs_compliance_level: level-3` ⇒ base `operating_temp_max_c ≥ 40` (NEBS requires 40 °C continuous as a baseline).
2. `mounting_options` containing `vehicle` ⇒ `vibration_resistance_grms` should be populated.
3. `dc_power_voltages` non-empty ⇒ base `dc_power_supported: true`.
4. `short_depth_chassis: true` ⇒ base `depth_mm ≤ 500` (when both populated).
5. `environmental_class_labels` non-empty containing any non-A2 entry ⇒ base `ashrae_class_max ∈ {A3, A4, rugged}` (verbatim cert label set must be consistent with collapsed enum).

(Constraint `operating_temp_min_c < operating_temp_max_c` lives in base now. The former `extended_ambient` constraint was retired with the field on 2026-05-06.)

## Sub-shapes within the edge cohort

Three shape clusters worth knowing (all use the same overlay; differences are quantitative):

- **Telco / NEBS edge** — short-depth, NEBS Level 3, -48VDC standard. XR5610 / XR7620.
- **Industrial / ruggedized** — extended temp + shock + IP rating + conformal coating. XR8000 series, XR8000r (military). ThinkEdge SE-series.
- **Compute-at-edge** — milder ruggedization but extended ambient + small footprint + fanless options. ThinkEdge SE100/SE350. HPE Edgeline EL300/EL1000.

## Gold-set evidence map

| Overlay field | Surfaced by (in pilot or once edge cohort is pulled) |
|---|---|
| `environmental_class_labels` | All Dell XR (6/6 in 2026-05-06 audit). XR5610/XR7620 publish A2/A3/A4 + Edge1/Edge2; XR8000 family publishes ASHRAE A2 + NEBS3 + GR3108C1+ + GR3108C1-L + NEBS3-H. |
| `nebs_compliance_level` | All Dell XR (6/6 = `level-3`); ThinkEdge SE / Edgeline (post-MVP). |
| `ip_rating` | (none in Dell XR pilot — XR8000 tech-guide explicitly says "not a sealed chassis"). Post-MVP: ThinkEdge SE350 (IP55), XR8000 industrial variants if exposed. |
| `mil_std_810_methods` | XR5610 Table 35 (cleanly extractable: Method 514.6/514.8/516.8 entries); XR7620 Table 45. XR8000 family Table 28 explicitly N/A. |
| `mil_std_901_certified` | **XR5610 = true** (Table 36, p.62: "MIL-STD-901E, Grade A, Class 2, Type A, in approved military transit case (Pelican DE2412-05/24/05)"). XR7620 = false (Table 61: "901 MIL: Not supported"). XR8000 family Table 28 = N/A. (Corrected 2026-05-06 audit pass #2 — prior gold-set note "(none in pilot)" was wrong.) |
| `hazardous_location_certs` | (none in Dell XR pilot). XR8620t spec-sheet "Class 1" refers to NEBS GR-3108-CORE outside-plant Class 1, NOT the IEC/UL hazardous-location Class I Div 2 — captured by `environmental_class_labels`, not here. (Corrected 2026-05-06 — prior pointer was misread.) |
| `mounting_options` | All Dell XR = `["rack"]` (2-post or 4-post). XR5610 also qualifies in a Pelican DE2412 transit case for MIL-STD-901E shipping — captured by `mil_std_901_certified`, not as a `mounting_options` value. (`wall \| din-rail \| vehicle \| ceiling \| desktop` enum values 0/6 across Dell pilot — kept for ThinkEdge / Edgeline post-MVP.) |
| `dc_power_voltages` | XR-series uniformly publishes `[-48]` (telco LVDC) and/or `[240, 336]` (mixed-mode HVDC). Positive 12 / 24 / 48 V are Lenovo ThinkEdge / HPE Edgeline territory. |
| `dc_power_input_options` | Dell XR convention: spec-sheet PSU bullet verbatim, e.g. `"1100 W -48 to -60 VDC"`, `"1400 W Titanium 277 VAC or 336 VDC"`, `"1800 W Titanium 200—240 VAC or 240 HVDC"`. Connector geometry (`-48VDC barrel`) is HPE/Lenovo style and not in Dell sources. |
| `fanless_variant_available` | (none in Dell XR — all 6 ship with fans). Post-MVP: ThinkEdge SE100/SE350. |
| `short_depth_chassis` | All XR ≤ 472 mm (XR5610 463 mm, XR7620 472 mm, XR8000 family 430 mm). |

## Out-of-scope for this overlay

- **Storage-dense edge variants** — captured via base `workload_tags`, not here.
- **GPU-equipped edge** — when an edge server has GPUs as an option (XR7620 supports up to 2× 250W DW GPUs), base `supports_pcie_gpu` and `supported_gpus` cover it. Don't duplicate in overlay.
- **Vehicle-specific mounting hardware** (lock-down kits, MIL-circulars) — out of structured scope; vendor_extensions if needed.
- **Hardened OS images** — software, not hardware. Base `supported_os` lists the OS; hardening posture is downstream of this schema.

## What this overlay does NOT do

- Does not redefine any base server.md field.
- Does not model fault-tolerance / lockstep — that's the deferred `fault-tolerant-system` category.
- Does not model the chassis side of edge (e.g. NEMA enclosures around an edge server) — out of scope.
