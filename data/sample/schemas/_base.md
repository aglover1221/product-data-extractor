---
name: base-schema
description: Common contract shared by all per-category schemas — the universal product line + product directory pattern, source row schema, audit_status enum, vendor naming conventions, and cross-cutting rules every product MD must satisfy regardless of category. Referenced from server.md, storage.md, hci.md, networking.md.
type: schema
category: _base
last_updated: 2026-05-07
---

# Base Schema (Cross-Category Contract)

Every per-category schema (server, storage, hci, networking) inherits from this. The intent is DRY — fields and rules that apply to every product live here, category-specific fields and required body sections live in the per-category schema.

## Universal directory pattern: product line + product

Every category uses the same pattern. A **product line MD** documents the product line as a whole (the "legend" — overview, portfolio shape, lifecycle, comparison, routing). Zero or more **product MDs** under it document specific products within the product line (a server model, a storage array, a switch SKU, a stack variant, a rebadged HCI node).

```
{vendor}/{category}/{product-line-slug}/
├── {product-line-slug}.md                ← product line MD (the legend)
├── source/                    ← shared product-line-level source PDFs
├── {product-1}/{product-1}.md ← per-product MD
├── {product-1}/source/        ← per-product source PDFs (when distinct from product line)
├── {product-2}/{product-2}.md
└── ...
```

This pattern is intentionally vendor-agnostic. It works for:

- **Server product lines** (Dell PowerEdge, HPE ProLiant, Cisco UCS): product line MD documents the portfolio; product MDs document each model.
- **Storage product lines** (Dell PowerStore, NetApp ONTAP, Pure FlashArray): product line MD documents the platform; product MDs document each array model.
- **Networking product lines** (Dell PowerSwitch S, NVIDIA Spectrum, Cisco Nexus 9000): product line MD documents the product line; product MDs document each switch SKU.
- **HCI product lines** (Dell PowerFlex, Dell XC, Dell APEX, NetApp HCI, HPE GreenLake): product line MD documents the offering; product MDs document hardware nodes, stack variants, or other distinct sub-products.
- **Software-only product lines** (Dell PowerFlex software, NetApp Cloud Volumes ONTAP): product line MD is sufficient; the products list may be empty.

When a product line has no distinct sub-products to break out — typically pure software products with no SKU breakdown — the product line MD stands alone with `products: []`. This is a degenerate but valid case.

When a product line has many distinct products (PowerEdge: 38, PowerScale: 14, PowerStore: 12), each product gets its own MD. The product line MD is the navigation guide that lets an agent find the right product without reading every product MD.

## Manifest as canonical index

Every product MD's frontmatter `sources:` list is the **canonical, exhaustive index** of every source that applies to that product. The same is true of every product line MD's `sources:` for the line itself. This is the load-bearing contract for agentic traversability: a consumer (extractor, viewer, MCP server, downstream agent) reads ONE file — `{product}/{product}.md` — and has the full list, typed, audit-tracked, with paths to the parsed sidecars.

Sources can apply at three scopes:

```
{category}/{vendor}/                              ← category-scope source/ (optional)
├── source/                       ← cross-product-line shared sources (e.g. an OS spec sheet covering several switch product lines)
└── {product-line-slug}/
    ├── {product-line-slug}.md    ← line MD; lists own-scope + category-scope sources
    ├── source/                   ← line-scope shared sources
    └── {product-slug}/
        ├── {product-slug}.md     ← product MD; lists own-scope + line-scope + category-scope sources
        └── source/               ← product-scope sources only
```

Implications, all binding:

- **Manifest is contract; filesystem is storage.** Each PDF lives at exactly one physical location (the highest scope where it applies). PDFs are never copied across scopes.
- **Manifest paths are relative to the MD that contains them.** A product MD lives at `{product-dir}/{slug}.md` and its own-scope source files live at `{product-dir}/source/<file>`, so own-scope rows are `local: source/<file>`. Line-scope rows are `local: ../source/<file>`. Category-scope rows are `local: ../../source/<file>`. A product line MD's own-scope rows are `local: source/<file>` and category-scope rows are `local: ../source/<file>`. The `local:` path always begins with `source/`, `../source/`, or `../../source/` — never a bare filename.
- **Product MDs MUST enumerate up-scope sources** that apply to them. The product MD is read in isolation — agents and tooling should never need to traverse the filesystem to discover applicable sources.
- **Skills read the manifest, not the directory.** Source enumeration for any single-product operation (extraction, audit, viewer rendering) reads the product MD's `sources:` frontmatter and resolves each `local:` path. Tools never `ls source/` to discover sources.
- **`sources.yaml` is acquisition audit, not a substitute index.** The yaml manifest in each scope records what was pulled when (URL, SHA-256, fetch date). The MD frontmatter is the consumer-facing contract. They are kept in sync but serve different purposes.

## Source row schema

Every entry in a product MD or product line MD's `sources:` list is a YAML object with these fields. The shape is identical across all categories.

| Field | Required | Notes |
|---|---|---|
| `local` | yes | Relative path from this MD to the original PDF. Conventions: own-scope = `source/<file>`; line-scope from a product MD = `../source/<file>`; category-scope from a product MD = `../../source/<file>`; category-scope from a product line MD = `../source/<file>`. The path always begins with `source/`, `../source/`, or `../../source/` — never a bare filename, since source files always live in a `source/` subdirectory at some scope. Stable, descriptive filename: `tech-guide.pdf`, `spec-sheet.pdf`, `platform-introduction.pdf`. Never the vendor's `manual30740463.pdf`. **A product MD's `sources:` MUST enumerate every applicable source, including up-scope refs — see "Manifest as canonical index" above.** |
| `local_extraction` | yes | Path to the `.md` sidecar of `local` (Reducto: HTML tables preserved, agentic OCR, inline figure crops). By convention `<name>.pdf` ⇒ sibling `<name>.md` in the same `source/` directory. The sidecar is the structured-extraction pipeline's primary input and the unstructured fallback for queries the schema doesn't cover. Both files MUST exist and stay in sync. |
| `type` | yes | Source type discriminator. See "Canonical source types" below. |
| `title` | yes | Document title verbatim from the cover page. |
| `url` | yes | Authoritative remote URL. Include `?language=en-us` for Dell. |
| `revision` | recommended | Vendor doc revision (e.g. "A07"). When absent, omit. |
| `date` | recommended | Publication date as printed. Free text accepted ("December 2025"). |
| `pages` | recommended | Integer page count. Lets the verifier sanity-check the file. |
| `audit_status` | yes | Set by `verify-product`. See enum below. |
| `audit_date` | yes | YYYY-MM-DD when audit_status was last set. |
| `notes` | optional | Free text. Use for "Re-pulled YYYY-MM-DD; body content may still reflect prior rev — re-synthesis recommended" or "Vendor index error: filename says X, content says Y". |

### `audit_status` enum

| Value | Meaning |
|---|---|
| `byte-identical` | The local file is byte-identical to the URL's current content as of `audit_date`. The MD body is in sync. |
| `re-pulled` | The vendor published a new revision; the local file was refreshed but the MD body may still reflect the prior revision. Re-synthesis is recommended. |
| `drift` | The local file and the URL's current content differ, AND the verifier found one or more body claims that the new file no longer supports. Action required. |
| `unchecked` | The verifier has not yet run on this source, or the URL was unreachable during the last audit. |

The verifier sets `audit_status` and `audit_date` automatically. Synthesis SHOULD NOT touch these fields directly.

## Evidence resolution in extraction.json

When `extract-product` writes a per-value evidence record into `extraction.json`, the `evidence.source` field MUST equal the manifest's `local_extraction:` path verbatim (the `.md` sidecar's path, not the PDF's). For example, if the product MD's `sources:` includes `local_extraction: source/technical-guide.md`, evidence sourced from that document is recorded as `"source": "source/technical-guide.md"`. For a line-scope source with `local_extraction: ../source/platform-introduction.md`, evidence is `"source": "../source/platform-introduction.md"`.

This makes evidence records:

- **Self-resolving.** A consumer joins the path against the product MD's directory to locate the parsed sidecar — no scope discriminator needed, no collision logic for shared filenames across scopes.
- **Stable across moves.** When dedup hoists a PDF up-scope, the manifest path updates and the evidence references update with it (same string substitution).
- **Grep-able.** Searching `extraction.json` for `"../source/platform-introduction.md"` finds every product whose extraction relies on that line-scope document.

Bare filenames (e.g. `"platform-introduction.md"`) are NOT permitted as evidence sources. Pre-2026-05-07 extractions produced bare filenames; any extraction predating the manifest-as-truth migration must be regenerated under the new shape.

## Canonical source types

Used by every category's `sources:` list and by the verifier when looking up sources by class. Each category schema specifies which of these types are required for that category.

| `type` | Purpose | Typical filename |
|---|---|---|
| `tech-guide` | Architecture, features, deep dive (50–110 pp). The "spine" for most servers. | `technical-guide.pdf` |
| `spec-sheet` | Per-model specs, limits | `spec-sheet.pdf` |
| `data-sheet` | Marketing positioning, "what's new" framing | `data-sheet.pdf` |
| `admin-guide` | Lifecycle, deployment, operations | `admin-guide.pdf` |
| `support-matrix` | Compat / dependency versions. The "spine" for HCI product lines. | `support-matrix.pdf` |
| `solution-brief` | Use-case framing | `solution-brief.pdf` |
| `brochure` | Portfolio-level marketing content (multi-product positioning, "what's the family for?" framing). Flagged separately from `data-sheet`/`solution-brief` so consumers can filter marketing-positioning content out of technical extraction. | `poweredge-servers-brochure.pdf` |
| `platform-intro` | Architecture overview (Dell storage convention) | `platform-introduction.pdf` |
| `third-party` | ESG/Forrester/IDC validation | `esg-validation.pdf` |
| `other` | Catch-all. Use sparingly — flag in synthesis if used. | — |

If a new source type is genuinely needed (e.g. a vendor introduces a new artifact category), the synthesizer SHOULD pause and ask the orchestrator. Don't extend the enum on the fly.

## Universal frontmatter rules

Every MD (product line or product), regardless of category, satisfies these:

| Field | Required | Notes |
|---|---|---|
| `vendor` | yes | "Dell Technologies" / "HPE" / "NVIDIA". Full vendor name, not abbreviation. |
| `category` | yes | One of `server`, `storage`, `hci`, `networking`. Drives schema selection. |
| `kind` | yes | `product_line` (for product line MDs) \| `product` (for product MDs). Tells the synthesizer and verifier which contract to apply. |
| `description` | yes | One- to two-sentence positioning of the product or product line (≤300 chars). What it is and who it's for, drawn from the spec sheet's overview blurb or the product line's own pitch. Distinct from — and shorter than — the prose `## Overview` body section. Used for viewer summaries, search, and LLM-context cards. |
| `product_line` | yes | Slug of the product line this MD belongs to. For a product line MD, `product_line: {own-slug}`. For a product MD, `product_line: {parent-slug}`. |
| `status` | yes | `current` \| `sustaining` \| `end-of-sale`. Always `end-of-sale` (not `eol`). |
| `last_updated` | yes | YYYY-MM-DD. |
| `sources` | yes | List of source row objects. ≥1 required for every MD. |

**Product Line MDs additionally have:**

| Field | Required | Notes |
|---|---|---|
| `products` | yes | List of slugs of every product MD in this product line. Empty list `[]` is valid for software-only product lines with no SKU breakdown. |

**Product MDs additionally have:**

| Field | Required | Notes |
|---|---|---|
| `parent_product_line` | yes | Relative path to the product line MD: `../{product-line-slug}.md`. |

**Optional universal fields (any MD):**

| Field | Required | Notes |
|---|---|---|
| `manufacturer` | optional | OEM that manufactures the product when distinct from `vendor` (the seller). Use for resold portfolios — e.g. Dell-resold NVIDIA networking (`vendor: "Dell Technologies"`, `manufacturer: "NVIDIA"`). Omit when the seller is also the manufacturer. Downstream consumers can filter on this field to surface OEM/reseller distinctions; when absent, treat the seller as the manufacturer. |

The per-category schema layers on top: required `model` / `product` name field, category-specific fields (e.g. `processor_family` for servers, `platform_type` for storage), and required body sections.

## Universal body rules — no prose

Portfolio MDs (product MDs and product line MDs) are **strictly frontmatter + `## Sources`**. No prose body. All unstructured content lives in the parsed-PDF `.md` sidecars in each MD's own `source/` directory; that is the only audit-tracked layer of unstructured data in the repo. The MD body is for navigation and the rendered audit trail, nothing else.

**Required body sections:**

- `# {Product Line or Product Name} — Technical Reference` — H1, name verbatim from frontmatter.
- `## Sources` — Rendered link tree to every file in `sources:`. Each line is `[link](path) — vendor title verbatim, revision, date.` This is the human-readable mirror of the frontmatter `sources:` list and the audit-trail manifest for the directory.

**Product Line MDs additionally include:**

- `## Products in this Product Line` — A table of every product MD in `products:` with one row per product. Columns are the product slug (cross-linked) plus structured fields lifted from each product MD's frontmatter (form factor, CPU family, role, etc.). No prose preambles, no per-row summaries that synthesize beyond the frontmatter.

**No other body sections.** Specifically: NO `## Overview`, NO `## Status`, NO `## Comparison and Positioning`, NO `## Stack Architecture`, NO `## Validated Stack`, NO `## Hardware (vs base server)`, NO `## Lifecycle Management`, NO `## Audit Pointers` synthesis tables. Per-category schemas MUST NOT add prose body sections — they may only add structured frontmatter fields. If a category needs a structured-data table (e.g. cluster scale limits) that lives in `extraction.json`, not in the MD body.

**No `## Support Model` section in any MD.** Support is a parallel concern documented separately at the vendor-support layer (e.g. `{vendor}/support/support.md`), not per-product.

**Why no prose:** every claim in the unstructured layer must trace to a parsed PDF (URL + SHA-256 + audit_status in `sources.yaml`). Hand-authored prose has no audit trail and drifts as sources update. Downstream agents — including `extract-product` when it produces `extraction.json`, and any MCP / web-app consumer reading product directories — read frontmatter for structured queries and walk the `source/*.md` sidecars for narrative content. The portfolio MD is the directory's table of contents, not the directory's encyclopedia.

## Universal writing rules

1. **No prose in portfolio MDs.** See above. Discovery docs, schema docs, and `_planning/*.md` are exempt — they are meta-docs, not portfolio content.
2. **Manifest is the canonical index.** Each product MD's `sources:` frontmatter is the exhaustive list of every source that applies to that product, including line-scope and category-scope sources referenced via relative paths (`../source/...`, `../../source/...`). PDFs are never copied across scopes — each lives at exactly one physical location and is referenced from each MD that needs it. Skills, the viewer, and downstream consumers read the manifest, not the directory tree, to enumerate sources. See "Manifest as canonical index" above.
3. **Frontmatter is the structured-data carrier.** Encode validated config (NICs, drives, GPUs, role flags, platform constraints) as structured frontmatter fields. Downstream consumers query frontmatter; they do not re-derive from prose.
4. **Cross-link don't duplicate, in frontmatter.** Per-SKU MDs reference base-server MDs via a `base_server_md:` field. Product MDs reference parent via `parent_product_line:`. Cross-links are pointers, not content copies.

## Naming conventions

- **Canonical product names:** "PowerEdge R770" (not "Dell PowerEdge R770", not "R770"), "Dell PowerStore" (not "PowerStore" — Dell-prefixed at the product line level for storage), "PowerSwitch Z9864F-ON" (not "Z9864F-ON" alone). Match the cover-page title of the spec sheet / tech guide. Search hit rate during discovery is meaningfully higher with the canonical name.
- **Slug convention:** lowercase, hyphenated, drop the product line prefix when nested under the product line directory. PowerEdge R770 → `r770`, PowerStore 5200T → `5200t`, PowerSwitch Z9864F-ON → `z9864f-on`.
- **Source filenames:** stable and descriptive (`technical-guide.pdf`, `spec-sheet.pdf`, `platform-introduction.pdf`, `support-matrix.pdf`). Never the vendor's hashed name (`manual30740463.pdf`). The vendor's URL goes in `url:`; the local filename is for humans.

## Date conventions

- All dates in YYYY-MM-DD format.
- When only month is known, use YYYY-MM-?? and flag in `notes:`.
- Today's date is sourced from the runtime, not hardcoded.

## How an agent decides "product line or product?"

When given a product to onboard, the agent first decides whether what's being onboarded is a product line or a product:

- If the product line MD doesn't exist yet (the product line is brand-new to the knowledgebase), **write the product line MD first**. Then write each product MD as a separate `add-product` invocation.
- If the product line MD exists but the specific product doesn't, write only the product MD and update the product line MD's `products:` list to include the new slug.
- If the product is itself the entire product line (software-only, single-SKU offerings), write the product line MD with `products: []`. No separate product MD.

The agent should always favor splitting when in doubt — it's easier to merge two MDs later than to split one. Per-product MDs let an agent answer "what's the spec of model X" without reading the entire product line.

## Cross-portfolio consistency

The portfolio guide (`dell/PORTFOLIO_GUIDE.md`) is hand-curated and lists every product line across the vendor's portfolio. When adding a new product line, the orchestrator SHOULD flag that PORTFOLIO_GUIDE.md needs a manual update — but this skill does not edit PORTFOLIO_GUIDE.md itself.

## Chassis membership pattern (cross-category mixin)

A growing set of overlays describe products that are **chassis-resident components** — they cannot operate standalone, they depend on a host chassis for power/cooling/lifecycle, and they cross-reference a chassis product by slug. As of 2026-05-07 this pattern recurs in:

- `schemas/overlays/multi-node.md` — server nodes in multi-node-dense chassis (Dell C6620 in C6600, Lenovo SD530 in D3, HPE XD220v in XD2000)
- `schemas/overlays/modular-sled.md` — server sleds in bladed chassis (Dell MX760c in MX7000, HPE Synergy 480 in Synergy 12000)
- `schemas/overlays/chassis-fabric.md` — networking switch modules in bladed chassis (Dell MX9116n / MX5108n in MX7000)
- (deferred) `schemas/overlays/liquid-cooled-tray.md` — server trays in liquid-cooled-rack chassis (Lenovo SD650 in N1380)

Rather than redefining the same chassis-membership fields per overlay, the eight canonical fields below are the **shared mixin**. Every overlay that applies to a chassis-resident product MUST populate these fields with these names. Category-specific extensions (mezzanine slots for sleds, fabric designation for switch modules, inter-node interconnect for multi-node) live on the overlay that needs them.

| Field | Type | Required | Notes |
|---|---|---|---|
| `installs_in_chassis_slug` | string | yes | Slug of the host chassis product. Resolves at `chassis/{vendor}/{product-line}/{installs_in_chassis_slug}/extraction.json`. The chassis is always extracted as a separate product — even when the vendor publishes a combined node+chassis tech guide (Dell C6600, Lenovo D3 lp1853-style combined Product Guides), the chassis spec is extracted into its own `chassis/{...}/extraction.json` for cross-vendor comparability. |
| `installs_in_chassis_vendor` | string | yes | Vendor publishing the chassis. Almost always equals the resident's own vendor; capture explicitly to support partner-resold variants (e.g. Dell-resold NVIDIA modules). |
| `host_chassis_type` | enum | recommended | `bladed` \| `multi-node-dense` \| `liquid-cooled-rack`. Mirrors `chassis.chassis_type`. Denormalized from the chassis cross-reference for query convenience — a consumer asking "give me all servers that go in a bladed chassis" can filter without joining `chassis/{...}/extraction.json`. |
| `bay_form_factor` | enum | yes | The host chassis bay shape this resident occupies. `single-width` \| `double-width` \| `half-height` \| `full-height` \| `1u-tray` \| `2u-tray` \| `1u-half-width-sled` \| `2u-half-width-sled` \| `1u-full-width-sled` \| `1u-quarter-width-sled` \| `proprietary` \| `io-module-half-width` \| `io-module-full-width`. Matches `chassis.bay_form_factor_primary` vocabulary plus sled / IO-module extensions. The IO-module values are chassis-fabric overlay only. |
| `bay_consumption_count` | integer | yes | Number of host chassis bays this single resident consumes. 1 for single-width / half-height / 1U-tray / IO-module-half-width residents. 2 for double-width / full-height / 2U-tray / IO-module-full-width residents. Used by the verifier to enforce `bay_consumption_count × units_per_chassis_max ≤ chassis.max_compute_bays` (or the relevant chassis-side bay count for IO modules). |
| `units_per_chassis_max` | integer | yes | Maximum residents of THIS specific model the chassis holds when populated exclusively with this model. MX760c: 8 in MX7000. C6620: 4 in C6600. MX840c: 4 in MX7000 (DW occupies 2 SW bays). MX9116n: 6 in MX7000 (one per fabric I/O bay; mounted in pairs across 3 fabrics). |
| `shares_chassis_power_and_cooling` | boolean | yes | True when the resident draws from the chassis-shared PSU pool AND chassis-shared fan complement. Collapsing the two booleans (PSU + cooling) reflects the cohort: across multi-node-dense, bladed, and liquid-cooled-rack chassis, a resident never shares one without sharing the other. False is reserved for hypothetical residents with their own PSU module (cohort-empty). |
| `chassis_managed_lifecycle` | boolean | yes | True when the host chassis's management plane (`chassis.mgmt_module_name`) orchestrates firmware, deployment, and profile templating for this resident. The structural discriminator between architecture branches: `chassis_type: bladed` residents (modular-sleds, chassis-fabric switch modules) cascade `true`; `chassis_type: multi-node-dense` residents (multi-node nodes) cascade `false` (each node has independent BMC and chassis has no orchestrator). |

Each overlay's required-fields table starts with a row that says "(composes the chassis_membership pattern — see `_base.md`)" and then proceeds with overlay-specific fields. The eight canonical fields are still listed in the overlay's matrix for extraction-time convenience; the source of truth for their semantics is this section.

### Optional shared fields (recommended, not required)

| Field | Type | Notes |
|---|---|---|
| `chassis_form_factor_description` | string | Free-text description of the host chassis. For convenience — mirrors the chassis product's `model` field. Lets a viewer / agent surface a human-readable label without fetching the chassis extraction. Example: `"PowerEdge MX7000 Modular Chassis"`, `"PowerEdge C6600 2U 4-sled Chassis"`. |
| `requires_chassis_to_operate` | boolean | Always true for residents in this pattern. Explicit field for verifier sanity-check (a `general-purpose` server miscategorized as a resident would surface as `false` here). Default `true`; populating is optional. |

### Cross-field constraints (verifier-enforced for any overlay applying this mixin)

These constraints apply automatically to any overlay that composes the chassis_membership pattern. Overlays don't re-declare them; they are enforced by reference.

1. `installs_in_chassis_slug` MUST resolve at `chassis/{installs_in_chassis_vendor-mapped-path}/{installs_in_chassis_slug}/extraction.json`. Verifier checks file existence as a soft cross-reference; missing file ⇒ warn (chassis may be deferred).
2. The referenced chassis's `chassis_type` MUST match `host_chassis_type` when both are populated. Mismatch ⇒ fail.
3. `bay_consumption_count × units_per_chassis_max ≤ chassis.max_compute_bays` (for compute residents) or `≤ chassis.fabric_io_module_bays` (for chassis-fabric residents). Verifier flags violations as warn.
4. `chassis_managed_lifecycle` must align with the host chassis's `chassis_type`: bladed ⇒ true; multi-node-dense ⇒ false; liquid-cooled-rack ⇒ either is permitted (Lenovo N1380 cascades true via SMM3).
5. The host chassis's `supported_compute_units` (or `supported_ethernet_switch_modules` / `supported_fc_switch_modules` / `supported_passthrough_modules` for chassis-fabric residents) SHOULD include this resident's `slug`. Verifier flags missing cross-reference as warn (chassis may not yet be re-extracted with the latest resident catalog).

### Why the names are vendor-neutral

`units_per_chassis_max` instead of `nodes_per_chassis_max` / `sleds_per_chassis_max` / `modules_per_chassis_max`. `bay_form_factor` instead of `node_bay_form_factor` / `sled_bay_form_factor`. `bay_consumption_count` instead of `chassis_slot_consumption` / `io_module_bay_count_consumed`. The vocabulary unification lets a downstream consumer query "for any chassis-resident product, how many fit per chassis" without knowing whether the resident is a sled, node, or switch module. Category-specific naming is preserved only where the concept itself is category-specific (mezzanine slots are sled-only; fabric_designation is switch-module-only).
