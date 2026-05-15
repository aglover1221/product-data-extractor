
# extract-product

**The pipeline is `.md`-only.** Every source listed in the product MD's frontmatter `sources:` must have its `local_extraction:` path resolvable on disk (i.e. the Reducto-rendered `.md` sidecar exists at the path the manifest names). The contract is "every manifest entry resolves," not "every filesystem PDF has a sidecar." If any `local_extraction:` path doesn't resolve, halt and run `pull-sources` first.

The extraction phase of the pipeline. Reads `pull-sources` output — `.md` sidecars (Reducto: HTML tables with proper `rowspan`/`colspan`, inline figure captions, `<!-- page: N -->` anchors) in `source/` — applies the category schema, and writes `extraction.json`. One LLM pass; the verifier (`cross-check-extraction`) catches gaps and the LLM-fill phase corrects them in a follow-up.

**Why `.md` (Reducto):** standard markdown can't express row/column spanning headers, but HTML can — and Reducto emits HTML `<table>` blocks for the complex multi-header tables (Dell PowerEdge thermal/memory matrices, multi-axis DIMM matrices). Reducto also preserves page anchors (`<!-- page: N -->`) and crops inline figures into `images/reducto/`, both of which the extractor uses for evidence anchoring.

```
{vendor}/{category}/{product-line}/{slug}/
├── source/
│   ├── technical-guide.pdf
│   ├── technical-guide.md         ← Reducto output (extractor input)
│   ├── spec-sheet.pdf
│   ├── spec-sheet.md              ← Reducto output (extractor input)
│   ├── images/reducto/            ← cropped figure / table images, JPEG
│   └── ...
└── extraction.json                ← output
```

## When to invoke

- After `pull-sources` has populated `source/` with PDFs and `.md` sidecars (Reducto).
- "Extract R770", "re-extract this product against the updated schema", "run extraction on the new ThinkSystem batch."
- After a schema bump — re-run on every product so all extractions conform to the latest contract.

Do NOT invoke for:
- Synthesizing prose. The pipeline doesn't produce prose docs anymore.
- Loading the DB. That's a downstream step; this skill only writes JSON.
- Re-extracting from PDFs directly. Always go through the `.md` sidecar so behavior is reproducible — if Reducto output is bad, fix that upstream by re-running `pull-sources`.

## Inputs

1. The product directory: `{vendor}/{category}/{product-line}/{slug}/`.
2. Every `.md` sidecar referenced by the product MD's frontmatter `sources:` list (resolving each `local_extraction:` path; Reducto-rendered). Source enumeration reads the manifest, NOT `ls source/`. The PDFs are reference material, not extraction input. The `images/reducto/` crops are visual reference for human review, not extraction input. If any `local_extraction:` path doesn't resolve to a file on disk, halt and run `pull-sources` — do not extract from PDFs directly.
3. The category schema. For `category: server`, that's `schemas/server.md`. For `category: storage` AND `subcategory: san-block-array`, that's `schemas/san-block-array.md`. For `category: storage` AND `platform_type: backup` (subcategory: `backup-target`), that's `schemas/backup-target.md`. For `category: storage` AND `platform_type: data-protection-software` (subcategory: `data-protection-software`), that's `schemas/data-protection-software.md`. Other storage subcategories (file, object) use `schemas/storage.md` (legacy). For `category: hci` (`product_type: hardware-node`), that's `schemas/hci.md`. For `category: software-defined-infrastructure` (`product_type: hardware-node`), that's `schemas/software-defined-infrastructure.md`. For `category: networking`, the base is `schemas/networking.md` v1.1 (universal-device base) and the device-class overlay `schemas/overlays/switch.md` v1.0 (always applies for the v1.0 cohort, which is `device_class: switch` only). Sub-overlays compose further by `fabric_type` (`ethernet-switch.md` v1.0 OR `fc-switch.md` v0.1) and by `mounting_class` (`chassis-fabric.md` v1.1 when `mounting_class: chassis-fabric`).
4. **Any overlays that apply** — see "Schema composition: base + overlays" below. Overlay files live in `schemas/overlays/`.
5. The base schema at `schemas/_base.md` for source-row format and audit-status enum.
6. **Vendor cross-cutting option matrices**, when present at `{category}/{vendor}/_options/*.txt` — currently GPU/accelerator matrices (HPE: `nvidia-accelerators-for-hpe.txt`, `amd-accelerators-for-hpe.txt`; Lenovo: `thinksystem-thinkagile-gpu-summary.txt`). These are vendor-wide reference docs, not per-product. Read them once when extracting GPU fields. See "GPU extraction: consult the cross-cutting matrix" below.

## Schema composition: base + overlays

Most categories layer architectural overlays on top of a base schema. The extractor's job is to (1) determine which overlays apply for the product, (2) load base + overlays, (3) walk every required field across the composed contract, (4) record the overlay assignment in `extraction.json`.

### Server overlays — single overlay, discriminated by `server_type`

For `category: server`, the base is `schemas/server.md`. Exactly one overlay applies, determined by the `server_type` enum on the base:

| `server_type` value | Overlay loaded |
|---|---|
| `general-purpose` | none (base only) |
| `gpu-server` | `schemas/overlays/gpu-server.md` |
| `edge` | `schemas/overlays/edge.md` |
| `scale-up` | `schemas/overlays/scale-up.md` |
| `multi-node` | `schemas/overlays/multi-node.md` |
| `modular-sled` | `schemas/overlays/modular-sled.md` |
| `liquid-cooled-tray` | dormant — no overlay file yet; flag and pause |

After determining `server_type`, read the overlay file end-to-end and walk its fields in addition to the base. Record the overlay name in `extraction.json`'s `overlays` field (a list of overlay-file basenames without extension).

- **Source-reading scope for server.** Read the product MD's frontmatter `sources:` list and resolve each `local_extraction:` path. The list is exhaustive — for PowerEdge it includes own-scope (`source/technical-guide.md`, `source/spec-sheet.md`) plus line-scope (`../source/poweredge-servers-brochure.md` on every SKU; `../source/edge-portfolio-solution-brief.md` on XR-prefixed SKUs). Do not `ls` any source directory; the manifest is the index. Evidence records cite the manifest path verbatim — e.g. `evidence.source: "source/technical-guide.md"` for own-scope or `"../source/poweredge-servers-brochure.md"` for line-scope. If the manifest is missing an applicable line/category source, that is a manifest gap — halt and surface; do not paper over by reaching into directories.
- **Line-scope docs for PowerEdge — what each is for.**
  - `../source/poweredge-servers-brochure.md` (every PowerEdge SKU, 6 pages): canonical anchor for `server_type` classification and portfolio positioning. Family → type mapping is published here verbatim — XE family → `gpu-server`; XR family → `edge`; R/T core (R260–R770, T160–T560) → `general-purpose`; R860/R960 → `scale-up`; C-series multi-node-dense (C6615, C6620 in C6600) → `multi-node`; HS-series (HS5610, HS5620) → `general-purpose` (standalone 2-socket racks despite "Hyperscale Next" CSP-channel branding); MX-series sleds (MX760c in MX7000) → `modular-sled`. Cite this brochure in `server_type.evidence` rather than synthesizing the classification from the per-product spec-sheet overview prose.
  - `../source/edge-portfolio-solution-brief.md` (XR-prefixed SKUs only, 7 pages): edge-specific evidence — ruggedization, environmental ratings, deployment patterns (retail, manufacturing, transportation, defense), short-depth / front-IO design claims. Feeds the `edge` overlay's environmental and deployment fields. Skip on non-XR SKUs.

### SAN block array overlays — multi-overlay composition by architectural class

For `category: storage` AND `subcategory: san-block-array`, the base is `schemas/san-block-array.md` (v1.1). Zero or more overlays apply, determined by the product's architectural class:

| Overlay | Applies when | Triggering evidence in source |
|---|---|---|
| `san-entry-das` | Entry-tier SAN array with DAS host-attach modes | "SAN/DAS" wording in spec sheet; `sas-das` block protocol; SAS-3/SAS-4 backend; "linear vs virtual storage modes"; single-controller variant offered |
| `san-hybrid-tiered` | Multi-media-class user-data auto-tiering (FAST VP-style) | Mixed SSD+HDD pools; "FAST VP" / "Automated Tiered Storage" / "auto-tiering between tiers"; heat-driven block relocation. **Excludes:** read-cache layers (FAST Cache → base bool), metadata-only acceleration (PowerStore SCM), and intra-flash auto-mixing (PowerMax TLC+QLC). |
| `san-clustered-federated` | Federated cluster of head-local appliances with cross-appliance volume mobility | "Up to N appliances per cluster"; volume mobility across appliances; head-local drives within each appliance |
| `san-shared-fabric-scale-out` | Multiple heads share access to all drives via backend fabric | "Every node accesses every drive"; NVMe-oF backend (Ethernet/InfiniBand) or proprietary fabric; system-bay or chassis packaging; engine-pair / node-pair scale-out; mainframe protocols (FICON/zHyperlink) |

**Composition rules** (enforced before extraction):

- At most ONE of `{san-clustered-federated, san-shared-fabric-scale-out}` per product (mutually exclusive cluster topologies).
- `san-shared-fabric-scale-out` is incompatible with `san-entry-das` and `san-hybrid-tiered`.
- `san-entry-das` and `san-hybrid-tiered` MAY compose (e.g. PowerVault ME5 in virtual mode with mixed-media pools).
- Empty overlay list = canonical case (single-appliance, head-local, single-tier all-flash, SAN-only mid-range — e.g. Unity XT 380F).

**Architectural classification rubric for the Dell SAN portfolio** (use as a worked example, not a hardcoded lookup — verify against the product's actual sources):

| Product line | Models | Overlays |
|---|---|---|
| PowerVault ME5 | ME5012/24/84/212/24/84 | `san-entry-das` + `san-hybrid-tiered` |
| Unity XT (hybrid, non-F) | 380, 480, 680, 880 | `san-hybrid-tiered` |
| Unity XT (all-flash, F) | 380F, 480F, 680F, 880F | base only |
| PowerStore (T and Q) | 500T, 500T-DC, 1200T, 3200T, 3200Q, 5200T, 5200Q, 9200T | `san-clustered-federated` |
| PowerMax | 2000, 2500, 8000, 8500 | `san-shared-fabric-scale-out` |

After determining overlays, read each overlay file end-to-end and walk its required fields. Record the overlay assignment in `extraction.json`'s `overlays` field as a list of overlay-file basenames (e.g. `["san-entry-das", "san-hybrid-tiered"]`).

### HCI hardware-nodes — no overlays, but `base_server` cross-link is load-bearing

For `category: hci` AND `product_type: hardware-node`, the schema is `schemas/hci.md`. **No overlays** apply in the current iteration (stack-variant products are deferred to a follow-up overlay). The HCI extraction is a thin overlay over the underlying base server's extraction:

- Determine `base_server` from the discovery MD or the spec-sheet's "Chassis" row (e.g. XC770 → `r770`; AX-760 → `r760`; VxRail VE-660 → `r660`; VS-760 → `r760` storage-optimized variant).
- Confirm `server/dell/poweredge/{base_server}/extraction.json` exists on disk before extracting. If it doesn't, halt — the cross-link must resolve.
- Do NOT re-extract base-server fields. The schema's "Inherited from base server" section enumerates the forbidden set: CPU/DIMM/PCIe/PSU full tables, dimensions, cooling, environmental envelope, full base-server drive/NIC/GPU catalogs. The verifier flags any HCI extraction that populates these as `fail`.
- The HCI extraction populates only the HCI value-add: stack identity, joint-support model, SDS engine, `storage_configurations` rows (one per tier as published in the per-product spec-sheet table), cluster scale, validated subsets (`validated_drives` / `validated_nics` / `validated_gpus` — narrower than base-server catalog), LCM tooling, RDMA networking flags.
- Stack-variant products (currently 2: APEX `microsoft-azure`, `redhat-openshift`) are **out of scope** for this iteration — pause and flag if encountered.
- **Source-reading scope for HCI.** Read the product MD's frontmatter `sources:` list and resolve each `local_extraction:` path. The list is exhaustive — it includes own-scope (`source/tech-guide.md`), line-scope (`../source/spec-sheet.md`, `../source/support-matrix.md`), and category-scope sources (`../../source/<file>` — rare). Do not `ls` any source directory; the manifest is the index. Evidence records cite the manifest path verbatim — e.g. `evidence.source: "source/tech-guide.md"` for own-scope or `"../source/spec-sheet.md"` for line-scope. If the manifest is missing an applicable line/category source, that is a manifest gap — halt and surface; do not paper over by reaching into directories.

### SDI hardware-nodes — no overlays, but `base_server` cross-link is load-bearing

For `category: software-defined-infrastructure` AND `product_type: hardware-node`, the schema is `schemas/software-defined-infrastructure.md`. **No overlays** apply (topology-variant products are out of scope for this iteration; SDI lines today are software-only at the topology level — Rack / Appliance / Custom Node / Public Cloud are documented inline in the product line MD). PowerFlex is the reference implementation. The SDI extraction is a thin overlay over the underlying base server's extraction, parallel to HCI:

- Determine `base_server` from the SKU's frontmatter `base_server` field (e.g. PowerFlex R760 → `r760`; PowerFlex R6625 → `r6625`).
- Confirm `server/dell/poweredge/{base_server}/extraction.json` exists on disk before extracting. If it doesn't, halt — the cross-link must resolve.
- Do NOT re-extract base-server fields. The base-server extraction owns CPU / DIMM / PCIe / PSU / dimensions / cooling / environmental / full base-server drive+NIC+GPU catalogs. SDI extraction MUST NOT populate those keys; the verifier flags any present key as `fail`.
- The SDI extraction populates only the SDI value-add: `architecture_modes` (from the product line frontmatter — inherited at product-line scope; per-SKU may carry `node_role`); `services_running.{mdm,sds,sdc,sdr,sdt}` (which PowerFlex services run on this node — booleans); `validated_nics_25gbe[]` and `validated_nics_100gbe[]` (the SDI-locked NIC subset, narrower than the base-server NIC catalog); `validated_gpus[]` (SDI-locked GPU subset); `boot` (locked BOSS-N1 config string); `mgmt_controller` (locked iDRAC version); `fg_layout_supported` and `sdpm_supported` booleans (encode the AMD-platform vs Intel-platform constraint and the FG-layout eligibility); `consumed_by_stacks[]`; `partner_software_vendors[]`. Any per-SKU constraint that's load-bearing (e.g. PowerFlex's "AMD platforms cannot run SDS") surfaces as a structured boolean, NOT as prose evidence.
- Topology-variant and standalone product types are out of scope for this iteration — pause and flag if encountered.
- **Source-reading scope for SDI.** Read the product MD's frontmatter `sources:` list and resolve each `local_extraction:` path. The list is exhaustive — for the PowerFlex bundle it includes own-scope (`source/<file>` if any per-SKU sources exist) plus line-scope sources (`../source/spec-sheet.md`, `../source/spec-sheet-5-0.md`, `../source/appliance-architecture-overview.md`, `../source/technical-overview.md`, `../source/appliance-administration-guide.md`, `../source/support-matrix.md`, `../source/solution-brief.md`). Do not `ls` any source directory; the manifest is the index. Evidence records cite the manifest path verbatim, e.g. `evidence.source: "../source/spec-sheet.md"`. If the manifest is missing an applicable line/category source, that is a manifest gap — halt and surface; do not paper over by reaching into directories.
- **Authoritative tables for SDI extraction:** `appliance-architecture-overview.md` Table 5 enumerates per-platform role assignments (storage / compute / hyperconverged); `technical-overview.md` Table 14 carries the BOSS-N1 boot lock and the load-bearing AMD-platform constraint (*"AMD processors are not supported on VxFlex Ready Node and do not support SDPMs or NVDIMMs. There is no support for fine granularity storage pools on AMD-based servers."*); `spec-sheet.md` "Node Options and Specifications" table is the per-platform validation profile (CPU / sockets / cores / memory / drives / NICs / GPUs); `support-matrix.md` carries the firmware-bundle / Intelligent Catalog version pins.

### Backup-target overlays — single overlay, discriminated by `form_factor_class`

For `category: storage` AND `subcategory: backup-target` (equivalent: `platform_type: backup`), the base is `schemas/backup-target.md`. At most one form-factor overlay applies, determined by `form_factor_class`:

| `form_factor_class` value | Overlay loaded |
|---|---|
| `physical-appliance` | none (base only) |
| `virtual-edition` | `schemas/overlays/backup-target-virtual-edition.md` |
| `scale-out-cluster-node` | RESERVED (post-MVP) — `schemas/overlays/backup-target-scale-out-cluster.md` not yet drafted; halt and flag |

**Triggering evidence in source for overlay assignment:**

- `virtual-edition` — "software-defined virtual appliance" / "deploy on VMware vSphere / Hyper-V / KVM" / cloud marketplace SKUs (AWS / Azure / GCP) / "scale in 1 TB increments" / "per-instance capacity ceiling." Example: DDVE.
- `physical-appliance` — concrete chassis dimensions / weight / PSU / thermal published in spec sheet; expansion shelves enumerated. Example: DD3410, DD9910, DD9910F.

**Composition rules** (enforced before extraction):

- At most ONE form-factor overlay per product (mutually exclusive).
- `virtual-edition` overlay REQUIRES `form_factor_class = virtual-edition` AND requires the physical-only field cluster (controller chassis, PSU, thermal, expansion shelves, dedicated mgmt port, hardware root of trust) to be `null` with `evidence: {status: "not-applicable-virtual"}` — the overlay enforces the cascade.
- Empty overlay list = canonical case (single-node physical PBBA — e.g. DD9910 hybrid, DD9910F all-flash).

**Architectural classification rubric for the Dell PowerProtect Data Domain product line:**

| Slug | Position | Form-factor class | Overlays |
|---|---|---|---|
| dd3300 | entry (sustaining) | physical-appliance | base only |
| dd3410 | entry (current) | physical-appliance | base only |
| dd6400 | mid (sustaining) | physical-appliance | base only |
| dd6410 | mid (current) | physical-appliance | base only |
| dd6900 | mid-high (current) | physical-appliance | base only |
| dd9410 | high (current; HA-capable) | physical-appliance | base only |
| dd9910 | flagship-hybrid (HA-capable) | physical-appliance | base only |
| dd9910f | flagship-all-flash | physical-appliance | base only |
| ddve | software-defined | virtual-edition | `backup-target-virtual-edition` |

Cross-vendor (post-MVP) — same shape applies: HPE StoreOnce 5260 → base only; HPE StoreOnce VSA → `backup-target-virtual-edition`; Quantum DXi9100 → base only; Quantum DXi V-Series → `backup-target-virtual-edition`.

After determining the overlay, read it end-to-end and walk its required fields. Record the assignment in `extraction.json`'s `overlays` field as a list of overlay-file basenames (e.g. `["backup-target-virtual-edition"]` for DDVE, `[]` for DD9910).

### Data-protection-software overlays — single overlay, discriminated by `consumption_model`

For `category: storage` AND `subcategory: data-protection-software` (equivalent: `platform_type: data-protection-software`), the base is `schemas/data-protection-software.md`. At most one consumption-shape overlay applies, determined by `consumption_model`:

| `consumption_model` value | Overlay loaded |
|---|---|
| `software-only` | none (base only) |
| `integrated-appliance` | `schemas/overlays/dps-integrated-appliance.md` |
| `saas` | RESERVED (post-MVP) — `schemas/overlays/dps-saas.md` not yet drafted; halt and flag |
| `hyperconverged-cluster` | RESERVED (post-MVP) — `schemas/overlays/dps-hyperconverged.md` not yet drafted; halt and flag |

**Triggering evidence in source for overlay assignment:**

- `integrated-appliance` — vendor publishes a paired-hardware spec sheet ("PowerProtect Data Manager Appliance Spec Sheet") with both DPS-compute chassis fields AND a bundled backup-target SKU (DM5510 + DD6410, NetBackup Flex Appliance + MSDP storage). Single-license / single-pane-of-glass framing.
- `software-only` — vendor publishes deployment-best-practices for OVA / cloud-marketplace AMI / native RHEL/SLES install only; backend storage is customer-choice or external-required.

**Composition rules** (enforced before extraction):

- At most ONE consumption-shape overlay per product (mutually exclusive).
- `integrated-appliance` overlay REQUIRES `consumption_model = integrated-appliance` AND a non-null `bundled_target_storage` cross-link path resolving to a `backup-target` extraction on disk. The overlay enforces vendor / product_line / slug / category / subcategory matches at audit time. **Wave-ordering implication:** the bundled-target extraction must exist before the integrated-appliance DPS extraction can be verified.
- Empty overlay list = canonical case (software-only OVA-deployed DPS — e.g. PPDM software-only, Veeam Backup & Replication, Veritas NetBackup software).

**Architectural classification rubric for the Dell PowerProtect Data Manager product line:**

| Slug | Consumption | Overlays | `bundled_target_storage` cross-link |
|---|---|---|---|
| dm5500 | integrated-appliance (sustaining) | `dps-integrated-appliance` | `storage/dell/powerprotect-data-domain/dd6400/extraction.json` |
| dm5510 | integrated-appliance (current) | `dps-integrated-appliance` | `storage/dell/powerprotect-data-domain/dd6410/extraction.json` |

PPDM software-only deployment is captured as a value in the base `alternate_consumption_models` list on the existing DM5510 SKU — there is NO sibling `ppdm-software` slug. The same software ships in both shapes; the SKU in the discovery MD is the appliance bundle.

Cross-vendor (post-MVP) — same shape: Veeam Backup & Replication → base only; Veritas NetBackup software → base only; Veritas NetBackup Flex Appliance → `dps-integrated-appliance` with cross-link to the paired NetBackup MSDP appliance extraction; Cohesity DataPlatform → `dps-hyperconverged` (RESERVED); Druva → `dps-saas` (RESERVED).

After determining the overlay, read it end-to-end and walk its required fields. Record the assignment in `extraction.json`'s `overlays` field (e.g. `["dps-integrated-appliance"]` for DM5510, `[]` for a hypothetical PPDM-software-only SKU).

### Networking switches — multi-overlay composition by `device_class` × `mounting_class` × `fabric_type`

For `category: networking`, the base is `schemas/networking.md` (v1.1, universal-device base). Three orthogonal discriminators drive overlay composition:

1. **`device_class`** (top-level, switch / router / firewall / load-balancer / wireless-ap / wireless-controller / sd-wan-edge). For the v1.0 cohort all extractable products are `device_class: switch` — every other value is reserved and **halt-and-flag** (no overlay drafted). The switch overlay (`schemas/overlays/switch.md` v1.0) ALWAYS applies when `device_class: switch` and carries switch-universal fields (port_groups, ASIC, supported_optics, product_skus catalog, `fabric_type` discriminator).
2. **`fabric_type`** (sub-discriminator within switch): drives sibling sub-overlay composition.
3. **`mounting_class`** (form / installation pattern): drives standalone-vs-chassis-shared power/cooling cascades and chassis-fabric cross-references.

| `fabric_type` value | Sub-overlay loaded | Status |
|---|---|---|
| `ethernet` | `schemas/overlays/ethernet-switch.md` (v1.0) | active |
| `fibre-channel` | `schemas/overlays/fc-switch.md` (v0.1 — single-vendor cohort caveat) | active |
| `infiniband` | `schemas/overlays/ib-switch.md` (v0.1 — single-vendor cohort caveat; NVIDIA owns the IB market post-Mellanox) | active (2026-05-08) |
| `converged` | `ethernet-switch.md` AND `fc-switch.md` simultaneously | RESERVED — cohort-empty for v1.0 |

| `mounting_class` value | Additional overlay | Notes |
|---|---|---|
| `tor` / `spine` / `campus` | none | Standalone fixed-form rack-mount switch; PSU complement on base populates. |
| `branch` | none | Edge / ruggedized 1U fixed-form switch (Dell PowerSwitch E3200 family). Same Ethernet capability profile as campus; PSU complement on base populates. PoE budget + ruggedization-specific knobs land in `vendor_extensions.{vendor}.poe_*` (PoE class supported, max power budget per port, total PoE budget) and `vendor_extensions.{vendor}.ruggedization_*` (extended operating temperature, fanless mode, MTBF) until a dedicated `edge-networking.md` overlay drafts. Operating-temp envelope itself is on networking.md base — capture extended ranges (e.g. -40°C to 75°C) verbatim. |
| `chassis-fabric` | `schemas/overlays/chassis-fabric.md` (v1.1) | Sled-shape switch in bladed-chassis I/O bay. **Cascades base PSU/fan/airflow/rack_units to null.** Adds `installs_in_chassis_slug` cross-link, internal/external port split, fabric expansion. |
| `director-modular` | RESERVED — `director-modular.md` not drafted | **Halt and flag** (cohort-empty for v1.0). |
| `desktop` / `virtual-appliance` | RESERVED | **Halt and flag** — not active for v1.0 networking extraction. |

**Composition rules** (enforced before extraction):

- `device_class: switch` ⇒ `switch.md` MUST be in the overlay list.
- `fabric_type` MUST be populated when `device_class: switch`. Exactly one fabric-type sub-overlay applies (or two for the cohort-empty `converged` case).
- `mounting_class: chassis-fabric` ⇒ `chassis-fabric.md` MUST be in the overlay list AND base power/cooling fields MUST cascade to `null`.
- `fabric_type: fibre-channel` ⇒ `ethernet-switch.md` MUST NOT apply (Ethernet-specific fields are null-by-non-application; verifier checks).
- `mounting_class ∈ {chassis-fabric, director-modular}` OR `fabric_type: fibre-channel` ⇒ `supports_stacking` MUST be `false` or `null + source-silent`. Verifier fails on `true`.

**Architectural classification rubric for the Dell networking portfolio** (extraction-ready v1.0 cohort):

| Product line | Models | `device_class` | `mounting_class` | `fabric_type` | Overlay chain |
|---|---|---|---|---|---|
| PowerSwitch Z (DC spine/aggregation) | Z9100-ON, Z9264F-ON, Z9332F-ON, Z9432F-ON, Z9664F-ON, Z9864F-ON | switch | spine | ethernet | `[switch, ethernet-switch]` |
| PowerSwitch S (DC ToR/leaf) | S5212F-ON, S5224F-ON, S5232F-ON, S5248F-ON, S5296F-ON, S5448F-ON | switch | tor | ethernet | `[switch, ethernet-switch]` |
| PowerSwitch N (campus) | N1100/N2200/N3200 series (19 SKUs) | switch | campus | ethernet | `[switch, ethernet-switch]` |
| PowerSwitch MX (chassis-fabric I/O modules) | MX9116n, MX5108n | switch | chassis-fabric | ethernet | `[switch, ethernet-switch, chassis-fabric]` |
| Connectrix (Dell-resold Brocade FC) | DS-7720B | switch | tor | fibre-channel | `[switch, fc-switch]` |
| NVIDIA Spectrum-X (AI fabric Ethernet) | SN2201 (campus), SN5400 (TOR), SN5600 (spine) | switch | campus / tor / spine | ethernet | `[switch, ethernet-switch]` |
| PowerSwitch E (edge / ruggedized) | E3224F-ON, E3248P-ON, E3248PXE-ON | switch | branch | ethernet | `[switch, ethernet-switch]` |
| NVIDIA Quantum (InfiniBand) | QM9700, QM9790 (Quantum-2 NDR); Q3200-RA, Q3400-RA (Quantum-3 XDR) | switch | tor / spine | infiniband | `[switch, ib-switch]` |

**Halt and flag — only the following remain not extractable until further overlay work lands:**

| Product line | Models | Reason | Resolution path |
|---|---|---|---|
| FC director-modular | Brocade X7-class, Cisco MDS 9700-class | `mounting_class: director-modular` overlay (`schemas/overlays/director-modular.md`) not drafted | Cohort-empty for Dell MVP — defer until first product enters scope |
| Routers / firewalls / load-balancers / wireless / SD-WAN | Future cohorts | `device_class: router/firewall/load-balancer/wireless-ap/wireless-controller/sd-wan-edge` overlays not drafted | Per architecture review §3, post-MVP cohorts |

**Source-reading scope for networking.** The product MD's frontmatter `sources:` list is the exhaustive index. Three scope levels in active use:

- **Own-scope** (`source/<file>`) — per-SKU spec sheet when one is published.
- **Line-scope** (`../source/<file>`) — family-shared spec sheets are common (Connectrix DS-7700B family covers DS-7710B / DS-7720B / DS-7730B in one PDF; S5200-ON family covers 5 SKUs; N3200-ON covers 9 SKUs). The same line-scope file is referenced from every sibling product MD; do not copy the file across product directories.
- **Category-scope** (`../../source/<file>`) — Dell networking-portfolio-wide NOS spec sheets live at `networking/dell/source/`: `smartfabric-os10-spec-sheet.md` and `enterprise-sonic-spec-sheet.md`. These are referenced from EVERY Dell DC-class switch's product MD; they back the `supported_nos` / `default_nos` / `supports_onie` fields on the base.

Resolve each `local_extraction:` path verbatim; do not `ls` source directories. Evidence records cite the manifest path as-is — e.g. `evidence.source: "source/spec-sheet.md"` (own), `"../source/n3200-on-spec-sheet.md"` (line), or `"../../source/smartfabric-os10-spec-sheet.md"` (category). If the manifest is missing an applicable line/category source, halt and surface — do not paper over by reaching into directories.

**Per-overlay extraction ordering.** Walk the schemas in this order to keep the cascade rules consistent:

1. `schemas/_base.md` (universal frontmatter + source-row format).
2. `schemas/networking.md` (universal-device base — identity, physical, environmental, power-when-standalone, mgmt, security, NOS catalog shape, certifications, warranty, lifecycle).
3. `schemas/overlays/switch.md` (port_groups, ASIC, supported_optics, product_skus; fixes `fabric_type`).
4. `schemas/overlays/ethernet-switch.md` OR `schemas/overlays/fc-switch.md` (fabric-type-specific performance + NOS capabilities + security).
5. `schemas/overlays/chassis-fabric.md` (when `mounting_class: chassis-fabric` — chassis_membership cross-link, internal/external port split, module-level power telemetry, fabric expansion).

After determining the discriminators and overlays, walk every required field across the composed contract. Record the overlay list in `extraction.json`'s `overlays` field, e.g.:

- Z9332F-ON: `["switch", "ethernet-switch"]`
- DS-7720B: `["switch", "fc-switch"]`
- MX9116n: `["switch", "ethernet-switch", "chassis-fabric"]`

### Schema-version recording

The extraction's `extraction_metadata.schema_version` MUST capture both base and overlays:

- Base only: `"san-block-array v1.1"`
- With overlays: `"san-block-array v1.1 + overlays: [san-entry-das, san-hybrid-tiered]"`
- Server gpu-server: `"server v2026-05-04 + overlays: [gpu-server]"`
- HCI hardware-node: `"hci v2026-05-07 + overlays: []"` (also record `base_server: {slug}` at the top level)
- SDI hardware-node: `"software-defined-infrastructure v2026-05-07 + overlays: []"` (also record `base_server: {slug}` at the top level)
- Backup-target physical (DD9910): `"backup-target v1.0 + overlays: []"`
- Backup-target virtual (DDVE): `"backup-target v1.0 + overlays: [backup-target-virtual-edition]"`
- DPS software-only: `"data-protection-software v1.0 + overlays: []"`
- DPS integrated-appliance (DM5510): `"data-protection-software v1.0 + overlays: [dps-integrated-appliance]"` (also record `bundled_target_storage: {repo-relative-path}` at the top level)
- Networking ToR/spine/campus Ethernet (Z9332F-ON, S5232F-ON, N3248TE-ON, SN5600): `"networking v1.1 + overlays: [switch, ethernet-switch]"`
- Networking chassis-fabric Ethernet (MX9116n, MX5108n): `"networking v1.1 + overlays: [switch, ethernet-switch, chassis-fabric]"` (also record `installs_in_chassis_slug` cross-link via the chassis-fabric overlay)
- Networking ToR FC (DS-7720B): `"networking v1.1 + overlays: [switch, fc-switch]"` (note: `fc-switch.md` is at v0.1 — single-vendor cohort caveat)
- Networking edge / branch Ethernet (PowerSwitch E3224F-ON, E3248P-ON, E3248PXE-ON): `"networking v1.1 + overlays: [switch, ethernet-switch]"` (mounting_class: branch; PoE budget + ruggedization in `vendor_extensions.dell.poe_*` / `ruggedization_*`)
- Networking ToR/spine InfiniBand (QM9700, QM9790, Q3200-RA, Q3400-RA): `"networking v1.1 + overlays: [switch, ib-switch]"` (note: `ib-switch.md` is at v0.1 — single-vendor cohort caveat)

## Output: `extraction.json`

A single JSON file at the product directory root (next to `source/`). Shape:

```json
{
  "vendor": "Dell Technologies",
  "category": "server",
  "product_line": "poweredge",
  "slug": "r770",
  "model": "PowerEdge R770",
  "overlays": [],

  "extraction_metadata": {
    "schema_version": "server v2026-05-04 + overlays: []",
    "extracted_at": "2026-05-01T12:34:56Z",
    "extractor": "claude-opus-4-7",
    "sources_consumed": ["source/technical-guide.md", "../source/spec-sheet.md"]
  },

  "server_type": {
    "value": "general-purpose",
    "evidence": {
      "source": "spec-sheet.md",
      "anchor": "Overview",
      "quote": "PowerEdge R770 is a 2U two-socket mainstream rack server",
      "confidence": 0.95
    }
  },

  "socket_count": {"value": 2, "evidence": { ... }},
  "processor_family": {
    "value": ["intel-xeon-6-pcore", "intel-xeon-6-ecore"],
    "evidence": { ... }
  },

  "cpu_skus": [
    {
      "model": "Xeon 6754P",
      "family": "intel-xeon-6-pcore",
      "clock_ghz": 2.5,
      "cache_mb": 144,
      "cores": 86,
      "threads": 172,
      "memory_speed_mt_s": 6400,
      "tdp_w": 350,
      "requires_dlc": false,
      "evidence": {
        "source": "technical-guide.md",
        "anchor": "Table 7. Xeon 6 P-core SKUs supported",
        "page": 19,
        "quote": "6754P | 2.5 | 144 | 86 | 172 | 6400 | 350",
        "confidence": 0.92
      }
    },
    ...
  ],

  "supported_dimms": [...],
  "drive_configurations": [...],
  "supported_drives": [...],
  "storage_controllers": [...],
  "boot_drives": [...],
  "supported_gpus": [...],
  "gpu_form_factor_support": [...],
  "supported_dpus": [...],
  "pcie_slots": [...],
  "riser_configs": [...],
  "psu_options": [...],
  "security_features": [...],
  "supported_os": [...],

  "sources": [
    {
      "type": "tech-guide",
      "title": "PowerEdge R770 Technical Guide",
      "url": "https://...",
      "local": "source/technical-guide.pdf",
      "local_extraction": "source/technical-guide.md",
      "revision": "A04",
      "date": "December 2025",
      "pages": 96,
      "audit_status": "byte-identical",
      "audit_date": "2026-04-30"
    },
    ...
  ]
}
```

### Evidence shape

Every scalar value and every subarray row carries an `evidence` object:

```json
{
  "source": "source/technical-guide.md",    // the manifest's `local_extraction:` path verbatim (own-scope = "source/<file>"; line-scope = "../source/<file>"; category-scope = "../../source/<file>")
  "anchor": "Table 12. Memory speed by CPU SKU",   // table caption or section heading
  "page": 28,                        // page from Reducto's `<!-- page: N -->` anchors
  "quote": "...",                    // ≤200 chars verbatim from the .md
  "confidence": 0.92                 // 0-1, your self-assessment
}
```

Special evidence values:
- `"evidence": {"source": "source-silent", ...}` — extractor read the relevant section and the source did not specify the value. Distinct from missing data.
- `"evidence": null` — extractor did not look for this value (rare; should be filled by LLM-fill phase).

For envelope scalars, attach `evidence` at the field level: `{"value": 2, "evidence": {...}}`.
For subarray rows, attach `evidence` at the row level (one evidence object per row, not per column).

### Confidence guidance

- `0.95-1.0`: value lifted verbatim from a clearly-labeled table or spec line.
- `0.80-0.94`: value clear from prose context but required minor synthesis.
- `0.50-0.79`: inferred from indirect statements ("up to X" + "all SKUs support") — flag for verifier review.
- `<0.50`: don't extract — leave null with `evidence: source-silent` and a note in `extraction_metadata.low_confidence_skipped[]`.

## Workflow

### 1. Read the schema (base + overlays)

1. Read `schemas/_base.md` for source-row format and audit-status enum.
2. Read the category base schema:
   - `category: server` → `schemas/server.md`
   - `category: storage` AND `subcategory: san-block-array` → `schemas/san-block-array.md`
   - `category: storage` AND `platform_type: backup` (subcategory: `backup-target`) → `schemas/backup-target.md`
   - `category: storage` AND `platform_type: data-protection-software` (subcategory: `data-protection-software`) → `schemas/data-protection-software.md`
   - Other storage subcategories (file, object) → `schemas/storage.md` (legacy; will eventually fan out into subcategory-specific schemas like san-block-array did)
   - `category: hci` AND `product_type: hardware-node` → `schemas/hci.md`
   - `category: software-defined-infrastructure` AND `product_type: hardware-node` → `schemas/software-defined-infrastructure.md`
   - `category: networking` → `schemas/networking.md` (universal-device base) + `schemas/overlays/switch.md` (always when `device_class: switch`)
3. **Determine which overlays apply** per the "Schema composition: base + overlays" section above:
   - For servers: skim the spec-sheet overview and product positioning to identify `server_type`. Load the corresponding overlay (or none for general-purpose).
   - For SAN block arrays: skim the spec-sheet/platform-introduction architectural sections (controller topology, drive ownership, media, host-attach modes) to determine which of the four overlays apply. Apply the composition rules. The Dell rubric in the schema-composition section is a worked starting point — verify against the product's actual sources.
   - For backup targets: read the spec-sheet form-factor section to determine `form_factor_class`. Physical-appliance → no overlay. Virtual-edition (DDVE-class — vendor publishes a separate "Virtual Edition" data sheet, deploy-on-hypervisor + cloud-marketplace SKUs, per-instance capacity ceiling) → load `backup-target-virtual-edition`. Scale-out-cluster-node → halt and flag (overlay reserved post-MVP).
   - For data protection software: read the spec sheets to determine `consumption_model`. If a paired `appliance-spec-sheet.pdf` exists in `source/` enumerating both DPS-compute and bundled backup-target hardware (PPDM Appliance pattern: 1U PPDM + 2U DD6410), → load `dps-integrated-appliance` AND determine the `bundled_target_storage` repo-relative path AND confirm that backup-target extraction exists on disk (halt if missing — wave-ordering requirement). Software-only-only → no overlay. SaaS / hyperconverged-cluster → halt and flag (overlays reserved post-MVP).
   - For HCI hardware-nodes: no overlays in this iteration. Determine `base_server` from the discovery MD or spec-sheet "Chassis" row, confirm `server/dell/poweredge/{base_server}/extraction.json` exists on disk, then halt if missing.
   - For SDI hardware-nodes: no overlays in this iteration. Read `base_server` directly from the per-SKU MD frontmatter, confirm `server/dell/poweredge/{base_server}/extraction.json` exists on disk, then halt if missing.
   - For networking switches: skim the spec sheet's overview / form-factor / port complement to determine `device_class` (always `switch` for v1.0), `mounting_class` (form / installation pattern — `tor` / `spine` / `campus` / `branch` / `chassis-fabric`), and `fabric_type` (`ethernet` for PowerSwitch Z/S/N/MX/E and NVIDIA Spectrum-X; `fibre-channel` for Connectrix DS-* / Brocade-resold; `infiniband` for NVIDIA Quantum). The Dell rubric in the schema-composition section is a worked starting point — verify against the product's actual sources. **Halt-and-flag products: any FC `mounting_class: director-modular`** (Brocade X7-class, post-MVP — `director-modular.md` overlay not drafted).
4. Read each overlay file end-to-end. Internalize the additional fields, tightened enums, and internal verifier rules.

Hold the composed contract in mind: base fields + tightened constraints + overlay-added fields. The extraction must satisfy the base AND every applied overlay.

### 2. Read every sidecar referenced by the product MD's `sources:` manifest

The corpus for any extraction is the union of `.md` sidecars listed in the product MD's frontmatter `sources:` block — own-scope (`source/<file>`), line-scope (`../source/<file>`), and (rarely) category-scope (`../../source/<file>`). Read the manifest; do not `ls` source directories. If the manifest is missing a source the extraction needs, that is a manifest gap (or a `pull-sources` gap) — halt and surface.

The tech guide is usually the spine; the spec sheet adds canonical scalar specs and pricing/lifecycle. Line-scope brochures and solution briefs anchor portfolio-positioning fields — see the per-category "Source-reading scope" subsections above (server, HCI, SDI) for what each line-scope doc is for. Other sources (admin guide, support matrix) fill in operational details.

When extracting from a `.md` sidecar:
- Tables are HTML `<table>` blocks. Read the headers (including any `colspan`/`rowspan`) before the data rows so you correctly map values to columns — the spanning structure is load-bearing for thermal matrices, multi-DPC memory matrices, and PSU heat tables.
- Page boundaries are marked `<!-- page: N -->`; cite them in `evidence.page`.
- Figure captions appear under `<figure>` blocks; the actual diagram crops live in `images/reducto/` but those are visual reference for human review, not extraction input.
- Each `<details>` "view source screenshot" block is a verification aid, not a source — ignore its content.

Keep a mental map of where each fact lives — you'll cite it in `evidence.anchor`. Use the manifest's `local_extraction:` path verbatim as `evidence.source` (own-scope = `source/<file>` like `source/technical-guide.md`; line-scope = `../source/<file>` like `../source/spec-sheet.md`; category-scope = `../../source/<file>`). The path always begins with `source/`, `../source/`, or `../../source/`.

### 3. Build the extraction in the order of the schema

Walk `schemas/{category}.md` top to bottom. For each field:

1. Find the source(s) of truth in the sidecar files.
2. Extract the value, normalize to the schema's type and enum.
3. Attach evidence pointing at the most specific anchor (table caption > section heading > paragraph context).
4. If you can't find it in any source, use `evidence: source-silent` with a brief note in `notes` if helpful.

For subarray rows, use the source's table directly when possible — quote the row's key column (e.g. CPU model number) in `evidence.quote`. When reading from HTML `<table>` blocks in a `.md` sidecar, treat row 1 of `<tbody>` as the data row — never confuse a `<th>` header row for data, especially in tables with multi-row spanning headers.

### 4. Self-check before writing

- Required fields with `Required: yes` across base AND every applied overlay: every one populated, or explicitly `source-silent`?
- Enum fields: every value drawn from the schema's enum (or overlay-extended enum where applicable)?
- Overlay tightenings honored: every base field that the overlay tightens (e.g. `drive_ownership_model = head-local` under `san-clustered-federated`) carries the tightened value.
- Composition rules satisfied: `overlays` list contains only allowed combinations (e.g. SAN: at most one of `{san-clustered-federated, san-shared-fabric-scale-out}`; `san-shared-fabric-scale-out` doesn't compose with entry-das or hybrid-tiered).
- Overlay internal verifier rules satisfied (each overlay file has its own "Internal verifier rules" section — walk them).
- Cross-field consistency: `supports_gpu: false` ⇒ `supported_gpus: []`. `lom_available: no` ⇒ no `lom_*` fields populated. `socket_count` matches the platform CPU SKUs you extracted. `flash_cache_layer_supported: false` ⇒ no `fast_cache_*` / flash-cache fields populated.
- `family` tags on `cpu_skus` and `supported_dimms` rows: every value present in the platform's `processor_family` list.

### 5. Write `extraction.json`

Write the file at the product directory root. Pretty-print with 2-space indent so it's readable. Don't strip nulls — explicit nulls with evidence are part of the contract.

### 6. Hand off to the verifier

`cross-check-extraction` runs next. Its report flags gaps for the LLM-fill phase to address.

## Heuristics for the LLM extractor

- **Tables are gold.** Vendor tech guides hand you most of the data on a platter. Find the right table, parse the row.
- **The spec sheet is the most reliable source for envelope scalars** (max memory, max drives, PSU max, dimensions). Use it first; verify against the tech guide.
- **The tech guide is the source of truth for tables** (CPU SKUs, DIMM matrix, PCIe slot map, riser configs). The spec sheet rarely repeats these.
- **Don't hallucinate generations.** If the source says "Xeon 6 P-core SKUs," don't extrapolate that E-core is also supported — only what's stated.
- **Drive ladders live in Core Options, not the Maximum Storage summary.** The "Standard Features → Maximum Storage" section gives the *envelope* (drive count × largest capacity per class) and is the right anchor for `max_drive_count` / `max_raw_capacity_tb` only. The **per-class drive ladder** lives in "Core Options → Drives" (HPE) / equivalent tech-guide drive table (Dell, Lenovo) — usually pages ~35-40 of the spec sheet, with sub-headings like "Hard Disk Drive", "Solid State Drive", "NVMe", "EDSFF". Each `supported_drives` row must anchor on the ladder list, NOT on the Maximum Storage summary. The summary only shows the largest drive in each class, so anchoring there will truncate `capacities` to a single value and miss whole drive classes (most commonly 2.5" 10K SAS HDDs, which never define max SFF capacity because SSDs do).
- **HDD-class coverage check.** Before finalizing `supported_drives`, walk every drive sub-heading in Core Options / drive table and verify you produced a row per `(form_factor × drive_type)` pair found there. Common classes that get missed: 2.5" SAS-HDD (10K Mission Critical), 2.5" SAS-HDD (15K), self-encrypting (SED / FIPS) variants. If a class is genuinely absent from the ladder, omit the row — but do not skip a class just because the Maximum Storage summary didn't break it out.
- **Boot drives often hide in tech-guide BOSS / IDSDM / NVDIMM sections.** Look for "BOSS-N1", "IDSDM", "Internal Dual SD Module" — these all describe boot media.
- **OCP and PCIe slot capability are NOT NIC SKU lists.** Capture the slot's capability (form factor, lane width, port-speed ceiling). Specific NIC card SKUs belong out-of-scope (configurator's job).
- **Riser-config tables are the GPU-vs-NIC tradeoff capture.** Quote the riser-config table verbatim; per-slot rows should carry `riser_codes` indicating which configs activate them.
- **GPU extraction: consult the cross-cutting matrix.** Vendor-wide GPU matrices live at `{category}/{vendor}/_options/*.txt` and are written by `pull-sources`. When extracting `supported_gpus` and related GPU fields, read these matrices in addition to per-product sources:
  - **HPE** has actively stripped accelerator SKU enumeration from per-product QuickSpecs (changelog "Removed HPE InfiniBand and NVIDIA accelerator obsolete SKUs", Feb 2026). The per-product QuickSpecs typically only retains 1–2 accelerator SKUs (often just NVIDIA L4) plus chassis-level statements like "up to 2 double-width GPUs at the front." For HPE servers, the cross-cutting `nvidia-accelerators-for-hpe.txt` and `amd-accelerators-for-hpe.txt` are the authoritative source for the enumerated GPU SKU list. Find the section/table that lists which HPE servers each GPU supports (typically a "Server Support" or "Compatible Servers" sub-section per GPU). Use the matrix file as the `evidence.source` (e.g. `"source": "_options/nvidia-accelerators-for-hpe.txt"`) when the per-product QuickSpecs is silent.
  - **Lenovo** publishes `thinksystem-thinkagile-gpu-summary.txt` (LP0768) with a server×GPU compatibility matrix in Tables 4–8 (one sub-table per server cohort). Lenovo per-product Product Guides usually enumerate GPUs adequately, so the matrix is primarily a cross-validation reference. If per-product and matrix disagree, prefer per-product (it's more often current to the SKU's regional configurability and TDP gating); flag the disagreement in `extraction_metadata.contradictions[]` with both quotes.
  - **Provenance precedence:** per-product source wins on form-factor caps, max counts, slot constraints, and PCIe-gen gating. Matrix wins on enumerated SKU set when per-product is silent. Always prefer the more specific source for a specific value.
  - **Don't fabricate matrix coverage.** If the matrix files don't exist on disk for this vendor, fall back to per-product source only and emit `evidence: source-silent` for missing GPU SKUs (don't invent a matrix file path).
- **SAN block array extraction: classify the architectural overlays first.** Before walking fields, determine which overlays apply. Anchor the classification on these four discriminators in the source:
  - **Drive ownership** — "every node accesses every drive" / NVMe-oF backend / system-bay packaging → shared-fabric. Else head-local.
  - **Cluster topology** — "Up to N appliances per cluster" with cross-appliance volume mobility AND each appliance owns its drives → federated. "Multiple node pairs share the drive fabric" → shared-fabric scale-out. Single dual-controller appliance with no clustering → neither (base only).
  - **Media composition** — "FAST VP" / "Automated Tiered Storage" / "auto-tier between SSD and HDD" with explicit user-data tiering → hybrid-tiered. NOT triggered by: read-cache layers (FAST Cache → base bool only), metadata-only tiers (PowerStore SCM → vendor_extensions), automatic intra-flash mixing (PowerMax TLC+QLC, PowerStore Q variants are all-QLC = single-tier).
  - **Host attach modes** — "SAN/DAS" wording + `sas-das` block protocol + linear-vs-virtual storage modes → entry-DAS. Plain SAN-only mid-range arrays → no overlay on this axis.
  Record the overlay assignment in `extraction.json`'s top-level `overlays` field. Then walk base + each loaded overlay's required fields. Validate the composition rules (`san-shared-fabric-scale-out` is mutually exclusive with all others; `san-entry-das` and `san-hybrid-tiered` may compose; at most one cluster-topology overlay). When a product clearly maps to the canonical case (single-appliance head-local single-tier all-flash SAN-only mid-range — e.g. Unity XT 380F), `overlays: []` is correct.
- **SAN extraction: head/appliance/engine/node-pair semantics.** The base uses `min_heads_per_cluster` / `max_heads_per_cluster` — vendor-neutral. Under `san-clustered-federated`, "head" = "appliance" (PowerStore: max=4). Under `san-shared-fabric-scale-out`, "head" = "node pair" / "engine" (PowerMax 2500: max=2). The vendor's marketing label can be captured in `vendor_extensions.{vendor}.{product_line}.head_unit_name` if it adds value, but the structural counts go on the base fields.
- **HCI extraction: `storage_configurations` rows track the per-product spec-sheet table.** AX/MC/XC/VxRail spec sheets format each product as a table where columns are storage-config tiers and rows are facts. The relation extraction is essentially a transpose. Common pitfalls:
  - **Don't collapse multiple configs into one row.** AX-760 has 4 columns (All-Flash All-SSD / All-Flash All-NVMe / Hybrid SSD+HDD / Hybrid NVMe+HDD); emit 4 rows. AX-770 has 1 column; emit 1 row. The relation degenerates cleanly.
  - **VxRail's `vsan_type` axis composes with `storage_architecture`.** A VxRail VE-660 has up to 4 (vSAN-Type × Storage-Type) tuples in spec-sheet columns. One row per tuple.
  - **`controller_mode` enum derives from `controller_name`.** "None" / "N/A" → `none`. "HBA 355i (Non-RAID)" → `hba-non-raid`. "PERC H755 with RAID 1, 5, 6, 10, 50, 60" → `raid-capable`.
  - **`cache_drive_*` fields are required ONLY for `storage_architecture: hybrid`.** All-flash configs MUST leave them null with `evidence: source-silent`. The verifier flags both directions.
  - **Per-config GPU support is a real axis, not always an envelope.** AX-760 disables GPU on hybrid configs and on All-Flash-with-rear-storage; capture per-row in `gpu_supported_in_this_config` and reflect on `validated_gpus[].valid_for_storage_configs`.
  - **`deployment_modes_supported` varies per row on VxRail.** VE-660 OSA-Hybrid supports HCI + Satellite + Dynamic; VE-660 ESA-NVMe is HCI-only. Don't roll up.
- **HCI: validated subsets, not the full base-server catalog.** `validated_drives` / `validated_nics` / `validated_gpus` are the **stack-narrowed subset** Dell qualifies for the HCI product line. The full catalog lives on the base server's extraction. Source for the validated subset is usually the per-product spec-sheet "Network cards" / "GPU" rows (envelope), supplemented by the support matrix for SKU-level detail when available.
- **HCI: RDMA flag is the load-bearing HCI-specific NIC field.** Capture `rdma_protocols` (`iWARP` / `RoCE`) verbatim from the spec-sheet "Network cards" row ("RDMA protocols support: iWARP, RoCE"). LOM-only-for-imaging entries get `[none]` and a note. `requires_rdma: true` for ESA / S2D / Nutanix-RDMA-mode; `false` otherwise. Cross-check `validated_nics` rows have at least one RDMA-capable card when `requires_rdma: true`.
- **HCI: don't re-extract base-server fields.** The "Inherited from base server" section of `schemas/hci.md` enumerates the forbidden set. The extraction's top-level keys for those fields MUST be absent (not null with evidence — fully absent). The verifier's no-overwrite rule flags any present key as `fail`.
- **HCI: `golden_image_release` is often source-silent.** AX/MC spec sheets uniformly defer to "the support matrix" for the bundled stack version. Accept `evidence: source-silent` with a `notes` pointer. VxRail spec sheets do publish vSAN ESA/OSA version explicitly — capture verbatim.
- **SDI: don't re-extract base-server fields.** Same rule as HCI. The `base_server` extraction owns CPU / DIMM / PCIe / PSU full tables, dimensions, cooling, environmental envelope, and the full base-server NIC/drive/GPU catalogs. The SDI extraction's top-level keys for those fields MUST be absent (not null-with-evidence — fully absent).
- **SDI: `services_running` is per-SKU and load-bearing.** PowerFlex MDM/SDS/SDC/SDR/SDT services do not all run on every platform. `appliance-architecture-overview.md` Table 5 enumerates per-platform role assignments; `technical-overview.md` Table 14 carries the AMD-platform constraint that locks SDS off AMD nodes. Encode as `services_running: {mdm, sds, sdc, sdr, sdt}` booleans. R660/R760 (Intel, storage-bearing) → all true; R860 (Intel, diskless) → only `sdc: true`; R6625/R7625 (AMD, compute-only) → only `sdc: true`.
- **SDI: validated subsets, not the full base-server catalog.** Same shape as HCI — `validated_nics_25gbe[]`, `validated_nics_100gbe[]`, `validated_gpus[]` are the SDI-locked subsets Dell qualifies for PowerFlex specifically. PowerFlex locks the NICs to 4 × 25 GbE (CX-6 Lx OR Broadcom 57414) OR 4 × 100 GbE (CX-6 DX OR Broadcom 57508) — narrower than the base PowerEdge NIC catalog. Source: `spec-sheet.md` "Node Options and Specifications" table.
- **SDI: AMD-platform constraint encodes as boolean fields, not prose.** `fg_layout_supported: false` and `sdpm_supported: false` for R6625/R7625; `true` for R660/R760. `technical-overview.md` Table 14 carries the verbatim quote. Don't surface the constraint as evidence prose — it's a structured fact.
- **SDI: `boot` and `mgmt_controller` are locked across the platform set.** All 5 PowerFlex SKUs ship with BOSS-N1 + 2×960 GB SATA M.2 RAID 1 + iDRAC 9. Capture verbatim per-SKU — even though identical across SKUs, the per-SKU MD encodes the lock structurally so the verifier can confirm uniformity.
- **SDI: PowerFlex 5.0 forward-compat is a separate spec sheet.** `spec-sheet-5-0.pdf` introduces the SAE distributed-erasure-coding architecture. For PowerFlex 4.x extractions, treat 5.0 as forward-compat metadata (e.g. `forward_compat_versions: ["5.0"]`) — don't merge 4.x and 5.0 architectural facts into the same extraction record.
- **Backup-target: classify the form-factor first.** Determine `form_factor_class` before walking fields. Spec-sheet publishes hardware-chassis rows (dimensions, weight, PSU, thermal, expansion shelves) → `physical-appliance`, no overlay. Vendor publishes a separate "Virtual Edition" data sheet with hypervisor-support + cloud-marketplace + per-instance-capacity-ceiling content → `virtual-edition`, load `backup-target-virtual-edition` overlay. Record the assignment in `extraction.json`'s `overlays` field. The form-factor classification drives the cascade for the entire physical-chassis field cluster — get it right first.
- **Backup-target: capacity model has THREE ceilings, not one.** `usable_capacity_max_tb` (post-RAID, pre-dedup — what backup software has as raw bytes), `logical_capacity_max_pb` (post-dedup — what backup software perceives as data stored), `cloud_tier_capacity_max_pb` (additional extension into object storage). Different fields, different units, different meanings. The DD9910 spec-sheet table has separate rows for each. Don't conflate. `cloud_tier_capacity_max_pb` is null on models that don't ship Cloud Tier (DD3410, DD9910F).
- **Backup-target: `data_reduction_ratio_typical` is a string with the colon.** Capture `"75:1 (typical, includes ~30% HW-assisted compression)"` verbatim — not `75.0` as a number. The colon notation, the "(typical)" qualifier, and the methodology aside are all load-bearing. Vendor methodology varies wildly across vendors (DD claims 75:1 hybrid / 50:1 all-flash; HPE StoreOnce claims ~20:1; ExaGrid claims ~5:1 long-term post-process); the field is most useful as "what the vendor claims" rather than "comparable across vendors."
- **Backup-target: throughput is in TB/hr, by protocol.** This is the carve-out from the SAN "no perf numbers" rule. `throughput_source_side_dedup_tbph_max` (DD Boost / Catalyst / OST / accent) is required when source-side dedup is supported — the vendor publishes it on every spec sheet (DD9910: 130; DD3410: 20.7). NFS / CIFS / VTL throughput is optional — most family spec sheets only publish the headline source-side-dedup number; per-product spec sheets may publish more.
- **Backup-target: `source_side_dedup_protocols` enum carries vendor brand names as values.** The field name is vendor-neutral; the value space catalogs each vendor's protocol brand: `dd-boost` (Dell), `catalyst` (HPE), `ost` (Veritas-coined OpenStorage Technology), `accent` (Quantum), `veeam-sos` (Veeam SOS API), `boostfs` (DD Boost over NFS). Same convention applies to `backup_protocols_supported`.
- **Backup-target: virtual-edition cascade uses `not-applicable-virtual` evidence, NOT `source-silent`.** When `form_factor_class = virtual-edition` and the overlay loads, the physical-only field cluster (`controller_chassis_form_factor`, `controller_chassis_dimensions_inches`, `controller_weight_lbs_max`, `controller_psu_rated_va`, `controller_thermal_btuh_max`, `controller_acoustic_bels_operating`, `expansion_shelf_types`, `max_shelves_per_appliance`, `dedicated_management_port`, `built_in_networking`, `hardware_root_of_trust`, `controller_redundancy_method`) MUST be `null` with `evidence: {status: "not-applicable-virtual"}` — the field doesn't apply to the form factor, distinct from "the source was silent on a field that should apply." The overlay enforces the cascade as an internal verifier rule.
- **Backup-target: `replication_modes` MUST NOT contain `sync`.** Sync replication is a primary-storage concept that does not apply to backup targets. Verifier-fail. Backup replication is `async-policy-based` and/or `async-continuous` only. If a vendor's marketing claims "synchronous backup replication," interrogate the source — they almost certainly mean continuous async with low latency, not true sync. Capture the actual semantic.
- **Backup-target: HA model cascade across the DD product line.** DD9910 / DD9410 = `active-standby` (vendor explicit: "High Availability active/standby configuration is supported with DD9910 and DD9410"); DD9910F = `single-controller` in the current generation (the all-flash variant deliberately doesn't carry HA — flag during extraction if reading a future revision); DD3410 / DD6410 / DD6900 / DD3300 / DD6400 = `single-controller`; DDVE = `single-node` (HA is the underlying hypervisor's responsibility). Cite the spec-sheet footnote that enumerates HA-capable models.
- **Backup-target: `s3-egress-only` ≠ `s3-ingest`.** Both are values in the `backup_protocols_supported` enum, and they mean different things. `s3-egress-only` is for cloud-tier output (DD: writing dedup'd data to AWS S3 / Azure Blob / etc. as a long-term-retention extension) — NOT primary backup ingest. `s3-ingest` is the rarer pattern of accepting backup data via the S3 API as primary ingest (some object-backup-targets do this). Don't confuse them. DD = `s3-egress-only`; do not include `s3-ingest`.
- **Backup-target: `vault_*` field cluster is required-when-vault-supported.** When `air_gap_vault_supported = true`, all of `vault_topology_options` (non-empty), `vault_recoverability_validation`, `vault_management_isolation` MUST be populated. `vault_analytics_platform_name` is optional brand string ("CyberSense", "Cohesity DataHawk"). Per the DD data sheet, all current PowerProtect Data Domain models support cyber-recovery vault deployment — `air_gap_vault_supported = true` across the line.
- **Backup-target: `integrated_backup_software` table is the spec-sheet partial list only.** The DD data sheet figure 2 enumerates ~12 backup softwares (Commvault, Veeam, HYCU, Cohesity, NetBackup, Oracle, SAP, IBM DB2, Cloudera, Greenplum, OpenText, Hortonworks, SQL Server) — capture exactly that list. Do NOT attempt to mirror the live DD Boost compatibility matrix (a separate vendor document with hundreds of entries that updates monthly). Authoritative source for full compatibility lives in the vendor's compatibility matrix, not this extraction. Note in `extraction_metadata.notes` that the captured list is the vendor-spec-sheet partial.
- **Backup-target: `instant_access_*` is vendor-published, not inferred.** The DD data sheet quotes "118K IOPS for 64 concurrent VMs" — capture both fields when published. Entry-class models (DD3410) likely don't ship the SSD-tier required for instant access; flag during extraction if the spec sheet doesn't address it. Cite the data-sheet footnote.
- **DPS: `protected_workloads` table is the load-bearing comparison axis.** Every workload kind the DPS protects gets a row. PPDM has ~12 rows: VMware vSphere, Microsoft Hyper-V, Nutanix AHV, Kubernetes (EKS / AKS / GKE / OpenShift Virtualization / VMware Tanzu — one row per platform), Microsoft SQL Server, Oracle RMAN, Microsoft Exchange, SAP HANA, file system (Windows / Linux / NAS / AIX — one row per OS family), cloud-native (AWS / Azure / GCP — one row per cloud), AI workloads, plus `primary-storage-snapshot` rows for PowerStore / PowerMax (Storage Direct Protection). Source: data sheet "Discover, Manage, Protect and Restore" bullets + deployment-best-practices Table 6 (per-workload user permissions, which enumerates every supported app).
- **DPS: `consumption_model` is single-value, alternate shapes are listed separately.** PPDM ships in two consumption shapes (software-only OVA + integrated DM5510 appliance). The SKU in the discovery MD is the appliance bundle, so `consumption_model = integrated-appliance`. The software-only deployment shape goes into `alternate_consumption_models: ["software-only-ova", "software-only-cloud-marketplace", "software-only-rhel-install", "software-only-sles-install"]`. Do NOT create a separate `ppdm-software` SKU directory — same software image, different consumption.
- **DPS: `bundled_target_storage` cross-link must resolve before extraction is verifiable.** When the `dps-integrated-appliance` overlay applies, set `bundled_target_storage` to the repo-relative path of the bundled backup-target's `extraction.json` (DM5510 → `"storage/dell/powerprotect-data-domain/dd6410/extraction.json"`). The verifier resolves the path at audit time — file must exist, vendor / product_line / slug must match, and the resolved extraction's `subcategory` MUST equal `backup-target`. Wave-ordering requirement: extract DD6410 (Wave 2) before DM5510 (Wave 3).
- **DPS: integrated-appliance compute fields cover the DPS half ONLY.** When extracting an integrated-appliance SKU (DM5510), the `compute_*` fields on the overlay cover ONLY the DPS-compute chassis (1U PPDM compute). The DD6410 backup-target's chassis fields (2U, weight, PSU, thermal, expansion shelves) are extracted on the DD6410's own `extraction.json`, NOT duplicated on the DM5510 extraction. The PPDM Appliance Spec Sheet has TWO chassis columns side-by-side; map the DM5510 column to `compute_*` overlay fields and ignore the DD6410 column (it's the bundled target's job to capture).
- **DPS: `total_solution_rack_units` is derived, mark it.** When populated, set `evidence.derived: true` with `evidence.derivation: "compute_chassis U + bundled_target_storage's controller_chassis_form_factor U"` (DM5510: 1 + 2 = 3). The verifier sanity-checks against the bundled extraction.
- **DPS: `compatible_backend_targets` table required-non-empty when `backend_storage_model ∈ {external-required, customer-choice}`.** PPDM = `external-required` + table rows for Dell PowerProtect Data Domain (DD Boost integration) and Dell PowerProtect DDVE. Cross-vendor: Veeam = `customer-choice` + many rows (DD via DD Boost, StoreOnce via Catalyst, S3-compatible object via S3-direct, Veeam Hardened Repository via Linux-immutable-XFS, etc.). Cohesity / Rubrik = `internal-included` + this table cascades empty (storage is part of the cluster, not external).
- **DPS: anomaly-detection cluster is required-when-supported.** When `anomaly_detection_supported = true`, both `anomaly_detection_method` (enum: `ml-on-metadata` for PPDM) and `anomaly_detection_scope` (non-empty enum-array; PPDM = `[backup-job-anomalies, primary-storage-snapshot-anomalies]` per the data sheet's "Detection capabilities now identify anomalies in PowerStore snapshots") MUST be populated. The brand-name string (`anomaly_detection_brand_name`) is optional.
- **DPS / backup-target: software-version-history is out of scope.** Same rule as the rest of the repo — capture `current_software_version` (best-effort from spec/data sheet) and `current_software_version_date` only. Don't try to enumerate DDOS / PPDM 19.x release-notes history.
- **Networking: classify the three discriminators first.** Before walking fields, fix `device_class` (always `switch` for v1.0 cohort), `mounting_class` (form / installation pattern), and `fabric_type` (Ethernet / FC / InfiniBand). The mounting_class drives the standalone-vs-chassis-fabric power/cooling cascade — get it right before extracting PSU / fan / airflow fields, because those cascade to `null` under `mounting_class: chassis-fabric`. The fabric_type drives which sub-overlay applies — load `ethernet-switch.md` OR `fc-switch.md` (not both) and walk only the relevant overlay's required fields.
- **Networking: family-shared spec sheets are the norm, not the exception.** Connectrix DS-7700B family covers DS-7710B / DS-7720B / DS-7730B in one PDF; S5200-ON family covers 5 SKUs (S5212F-ON, S5224F-ON, S5232F-ON, S5248F-ON, S5296F-ON); N3200-ON covers 9 SKUs. The product MD references the family doc with `local_extraction:` and the family doc carries per-SKU columns / rows. When extracting, find the SKU's column/row in the family table and quote that specific cell in `evidence.quote` — do not quote the family overview prose. The same family PDF is referenced from every sibling product MD; never copy the file across product directories.
- **Networking: Dell DC switches reference category-scope NOS spec sheets.** The `supported_nos` / `default_nos` / `supports_onie` fields surface from `../../source/smartfabric-os10-spec-sheet.md` and `../../source/enterprise-sonic-spec-sheet.md` (Dell networking-portfolio-wide docs at `networking/dell/source/`). The Enterprise SONiC spec sheet enumerates the supported-platform list per SONiC release; cite the matching release line for each switch SKU. Per-SKU spec sheets often pre-date the NOS support — e.g. Z9332F-ON spec sheet (June 2022) doesn't mention SONiC, but the Enterprise SONiC 4.5 (2025) spec sheet names Z9332F-ON in the supported list.
- **Networking: `port_groups` is the structured replacement for free-text port_count.** Walk every distinct port-group in the spec-sheet "Performance" / "Front Panel Port Configuration" / "Port density" section and emit one row per contiguous identical-port group. Each row has `port_count`, `native_speed_gbe` (Ethernet) OR `native_speed_gb_fc` (FC) — exactly one populated per fabric_type — `connector` enum, and `purpose` enum (`host` / `uplink` / `downlink` / `management` / `console` / `stacking` / `internal-fabric` / `inter-switch-link`). The headline `port_total_count` MUST equal the sum of `port_count` across all rows (verifier-enforced). For chassis-fabric switches, `internal-fabric` purpose flags the sled-facing midplane ports; `inter-switch-link` flags fabric-expansion ICLs (e.g. MX9116n's QSFP28-DD ports double as TOR uplinks AND fabric-expander connections — capture each functional purpose with separate rows when the spec sheet enumerates them).
- **Networking: `supports_breakout` and `breakout_speeds` are headline-level booleans + GbE-list, NOT FC.** Breakout is an Ethernet feature — Z9332F-ON's 400GbE QSFP56-DD ports break out to `[400, 200, 100, 50, 40, 25, 10]`. FC ports don't break out; `breakout_speeds` is empty for `fabric_type: fibre-channel`. The per-row `breakout_supported` and `breakout_speeds` overrides on `port_groups` are only useful when breakout is non-uniform across port groups (rare).
- **Networking: ASIC name is often source-silent.** Dell does not name the ASIC on every spec sheet (Z9332F-ON: source-silent; S5232F-ON: source-silent). When NOT named, set `asic_name: null` with `evidence: source-silent` and a brief note ("Dell does not publish ASIC name on this spec sheet"). NVIDIA Spectrum-X spec sheets DO name the ASIC ("NVIDIA Spectrum-4"); Brocade Connectrix data sheets sometimes name "Brocade Condor 5". Capture verbatim when published.
- **Networking: `vlans_max_metric` disambiguates two surface styles.** Dell PowerSwitch Z/S/N publish flat VLAN-ID counts (4 = 4094 IDs supported) → `vlans_max_metric: flat-id-count`. Dell PowerSwitch MX publishes a port × VLAN scaling product (60 = 60K total port-VLAN bindings) → `vlans_max_metric: port-x-vlan`. When `vlans_max_k` is populated, `vlans_max_metric` MUST be populated too (verifier-enforced). Read the spec sheet's exact wording before normalizing.
- **Networking: `security_features` controlled vocabulary, vendor-neutral primitives only.** The base `security_features` enum (`radius`, `tacacs`, `ldap`, `secure-boot`, `signed-firmware`, `https-mgmt`, `ssh-v2`, `snmp-v3-privacy`, `ip-acls`, `control-plane-acls`, `vty-acls`, `802.1x-port-based`, `rbac`, `rogue-nic-control`) applies across both Ethernet and FC. **FC-specific security primitives** (`dh-chap`, `fcap`, `port-binding`, `switch-binding`, `trusted-switch-cert`, `secure-syslog`, `secure-copy-scp`, `sftp`) live on the FC overlay's separate `fc_security_features` field — do NOT mix them into base `security_features`. If a vendor publishes a security feature outside the controlled vocabulary, stage it in `vendor_extensions.{vendor}.security_features_extra` and flag for vocabulary review (don't extend the enum on the fly).
- **Networking: chassis-fabric power/cooling cascade to null is verifier-enforced.** When `mounting_class: chassis-fabric`, the base fields `psu_count_max`, `max_psu_output_w`, `psu_redundancy`, `dc_power_supported`, `airflow_direction_options`, `fan_count_max`, `fan_redundancy`, `rack_units` MUST be `null` (NOT `source-silent` — they're chassis-scope, not extractor-miss). The chassis owns these. The chassis-fabric overlay adds `module_power_consumption_w_typ` / `module_power_consumption_w_max` for module-level power-budget telemetry. Verifier fails when any cascaded field is non-null on a chassis-fabric switch.
- **Networking: chassis-fabric `installs_in_chassis_slug` cross-link is load-bearing.** When `mounting_class: chassis-fabric`, populate the chassis_membership pattern's 8 canonical fields plus the chassis-fabric-specific top-level fields (`fabric_designation`, `fabric_purpose`, `paired_redundancy_count`, `internal_port_count`, `external_uplink_port_count`, `mgmt_via_chassis_module: true`, `supports_fabric_expansion`). The `installs_in_chassis_slug` resolves to `chassis/dell/poweredge-mx/{slug}/extraction.json` — verifier checks file existence as a soft cross-reference (warns if missing, since chassis extractions may land in a later wave).
- **Networking: `vendor_extensions.{vendor}.*` is the catch-all for vendor-named knobs.** Dell SmartFabric Services features (I/O Aggregation / Topology validation / Auto-heal / MCM up to 20 chassis), VLT specifics (Routed VLT / RPM/ERPM over VLT / VxLAN with VLT / VLT Minloss upgrade), Fresh Air 2.0 compliance, OpenManage Network Manager support, RFC compliance lists, MIB lists → `vendor_extensions.dell.*`. Brocade Fabric Vision / SANnav / FOS features → `vendor_extensions.brocade.*`. NVIDIA Spectrum-X AI fabric features → `vendor_extensions.nvidia.spectrum_x_features`. Cross-vendor concepts that have only emerged from one vendor stay in `vendor_extensions` and graduate to first-class fields once a second vendor exposes the same concept.
- **Networking: lifecycle dates are typically source-silent on networking spec sheets.** Dell networking spec sheets rarely publish `announced_date` / `ga_year` / `eos_date` / `eosp_date` / `eol_date`. Set these to `null` with `evidence: source-silent` and the cohort distributional check will accept (peers will be silent too). The `notes:` field on the spec-sheet source row may say "Document © 2022 Dell Inc." — that's the document date, not the product GA date.
- **Networking: no perf-numbers carve-out — capture them all.** Unlike SAN block array (no perf), networking schemas explicitly capture switching capacity, forwarding capacity, latency, packet buffer, MAC table size, IPv4 routes max, VLANs max, FC aggregate bandwidth, FC frame latency, FC frame buffers per ASIC, NOS capability booleans (L2/L3/EVPN/VxLAN/DCB/MLAG/RoCE/PTP/SDN-fabric for Ethernet; zoning/NPIV/FICON/ISL trunking/FPIN/in-flight encryption for FC). Walk every required field on the loaded sub-overlay and populate or `source-silent` each one explicitly.
- **For older models with no DLC option, `supports_dlc: false` and `evidence: source-silent` is wrong** — write `evidence: { ... quote: "Air cooling only" ...}` or `quote: <whatever proves it>`. `source-silent` is when the source genuinely doesn't address the question.
- **CXL memory is its own section in Dell tech guides** ("CXL memory" heading inside the Memory subsystem chapter). Two pieces matter:
  - **Platform-support statement at top of platform overview** ("CXL 2.0: support" / "CXL 2.0: Not supported" / "CXL 2.0: supports Type 3 memory"). Watch for CPU-family gating notes immediately after — "supported only on Intel Xeon 6 P-core" / "While the AMD 9005 series CPUs supports CXL 2.0 ... [this platform] does not support CXL". Vendor-CPU support is not sufficient; the platform must enable it. Populate `cxl_supported_families` only with families this platform enables, not with families the CPU supports.
  - **CXL memory configuration table** in the Memory chapter. Each row = one supported deployment. Capture: riser code, CPU0 port slots, CPU1 port slots, native DIMM config (verbatim), native DIMM total capacity, CXL AIC config, CXL total capacity, total system memory. One row per supported config; some are roadmap-gated (`available_at_launch: false`).
  - **Constraints note bullets** below the table go to `cxl_constraints` verbatim.
  - When `supports_cxl: false`, leave the entire CXL envelope and `cxl_configurations` empty / null — but mark each individual CXL field `evidence: source-silent` with a note pointing at the no-support statement.

## Error handling

- **Missing `.md` sidecar**: if any source row's `local_extraction:` path doesn't resolve to a file on disk, halt and surface the error. The `.md`-only contract requires every manifest entry to resolve to a Reducto sidecar — re-run `pull-sources` on the product (or fix the manifest path). Do not extract from PDFs directly.
- **Source contradicts itself**: spec sheet says 24 DIMM slots, tech guide says 32. Quote both in `evidence.quote` and pick the tech-guide value (it's more detailed); flag in `extraction_metadata.contradictions[]`.
- **Field genuinely missing across all sources**: `null` value with `evidence: source-silent`.

## Performance and scope

- Single product extraction is one agent task. Don't fan out across products from inside this skill — the orchestrator does that.
- For very long sources (≥80 pages), it's fine to extract section-by-section internally, but the output is one `extraction.json` per product.
- Don't load the existing DB. This skill produces JSON only.

## What this skill does NOT do

- Doesn't validate against peer cohort. That's `cross-check-extraction`.
- Doesn't load to DB. That's a downstream loader, derived from the schema.
- Doesn't fetch PDFs or run Reducto. Those are upstream (`pull-sources`).
- Doesn't synthesize prose. Prose extraction is gone.
