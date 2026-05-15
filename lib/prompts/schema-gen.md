# Schema Generation Prompt (Wave 7)

You are bootstrapping a brand-new category schema for the **product-mcp** structured-data extraction pipeline. Given N reference source `.md` sidecars (Reducto-parsed vendor PDFs) drawn from products in a future-target category, propose a draft category schema MD that follows the conventions documented in `schemas/_base.md`.

## What you are producing

A single markdown file — the body of `schemas/{category}.md` — ready to drop into the `product-mcp` schema directory and route through the human-driven schema editor for refinement. The output is a **first draft**: it does not need to be perfect, it needs to be a faithful inventory of the deterministic, comparable fields that recur across the reference sources, framed in the conventional schema-MD shape so that human review is a polish pass rather than a rewrite.

## Conventions you must follow

1. **Frontmatter block**, opening and closing with `---` fences. Required keys:
   - `name: {category}-schema`
   - `description: …` — one-paragraph intent of the schema. State the category, the kind of products it covers, the discriminating axes (form factor, role, etc.), and the active-scope cohort.
   - `type: schema`
   - `category: {category}`
   - `last_updated: {today YYYY-MM-DD}`

2. **Top-level H1** — `# {Category Title} Schema (Structured Data Extraction Contract)`. Match the cadence of `schemas/server.md` and `schemas/networking.md`.

3. **Section: Design intent** — short bullets that frame *why* this schema exists. Always include:
   - "Capture solution-oriented data only" (ceilings, options, supported lists, lifecycle — not marketing prose).
   - "Enforce the same shape across vendors."
   - "Track provenance per value, not per doc" (every extracted value carries an `evidence` pointer).
   - "Tolerate missing data, mark it" (`evidence: source-silent` distinct from extractor-miss `null`).

4. **Section: Identity** — fields that uniquely identify a product in this category. Always include the `_base.md` universal fields (vendor, category, kind, product_line, parent_product_line, status, last_updated, sources). Then add category-specific identity fields you observed in the references (e.g. `model`, `slug`, `description`, `regulatory_model`, `predecessor`, `successor`).

5. **Sections: structured fields** — group by topical cluster. Each cluster gets its own H2. Within a cluster, present fields as a markdown table with columns:

   | Field | Type | Required | Enum / format | Notes |

   - **Type** — one of `string` | `integer` | `number` | `boolean` | `enum` | `array<{...}>` | `object` | `date`. Pick what the cohort speaks to.
   - **Required** — `yes` | `recommended` | `optional` | `conditional`. Use `recommended` for fields that ≥80% of references cover. Use `conditional` when a field is mandatory only when another field is set.
   - **Enum / format** — concrete enum values from the cohort, or a regex/format hint, or `—` if free-text.
   - **Notes** — what the field captures, with worked example values verbatim from the references when helpful. Cite the source MD path in parentheses for traceability: `(observed in source/spec-sheet.md, source/technical-guide.md)`.

6. **Section: Overlay routing** — even when no overlays are proposed yet, declare an `Overlay routing` section that names the discriminator field (e.g. `server_type`, `device_class`, `platform_type`) and lists the values you observed in the references. This sets the contract for future overlays.

7. **Section: Evidence shape** — restate the per-value evidence contract from `_base.md`: `evidence: { source, anchor?, page?, quote, confidence }`, with `evidence.source` matching the manifest's `local_extraction:` path verbatim.

8. **No prose body for product MDs** — the schema describes structured frontmatter only. Do NOT propose narrative `## Overview` or `## Architecture` sections; per `_base.md`, portfolio MDs are strictly frontmatter + `## Sources`.

## Method — how to walk the references

1. Read every reference MD top to bottom.
2. Maintain a working list of fields. For each candidate field, record: name, observed type, observed values across references, source pointer.
3. **Promote a field into the schema** when ≥2 references speak to it OR when it is unambiguously load-bearing (vendor model name, lifecycle status). Singletons that don't recur are not schema-worthy — capture them in `notes:` comments on adjacent fields if they hint at future overlays, but do not add them as fields.
4. **Tighten enums when the cohort is consistent.** If three references use `1U`, `2U`, `4U` for form factor, declare an enum. If references split between `1U/2U` and free-text dimensions, leave it as a string with a format hint.
5. **Flag deferral candidates.** If you observe a structural axis that hints at a sub-type (e.g. some references describe rack mounting and others describe edge ruggedization), call it out at the bottom in a `## Deferred / future overlays` section with a one-line rationale. The human reviewer decides whether to spin an overlay.

## Vendor-neutral naming

Field names never carry vendor branding. Vendor-specific terminology lives in dedicated string fields:

- Good: `mgmt_controller_name: "iDRAC10"` / `mgmt_controller_name: "ProLiant iLO 6"`
- Bad: `idrac_version: 10`

Even though the MVP is Dell-only, name fields so a future HPE / Lenovo / Supermicro extraction populates the same shape without renaming.

## Output rules

- Output ONLY the schema markdown. Do not wrap in code fences. Do not add commentary before or after.
- The first character of your response must be `---` (the opening frontmatter fence).
- Stay under ~600 lines. Better to be a tight, accurate first draft than a sprawling speculative one — the human editor will extend.
