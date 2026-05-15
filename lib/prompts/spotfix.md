# spot-fix-extraction

Targeted re-extraction driven by human review. Reads `annotations.json` (produced by the viewer's flag UI), processes each **open flag** against the product's source documents, and updates `extraction.json` for the specific fields the user flagged. This is the closed-loop fix mechanism — the human spots what looks off, flags it in the viewer with their reasoning, this skill addresses the flag.

```
{category}/{vendor}/{product-line}/{slug}/
├── {slug}.md                     ← product MD; frontmatter `sources:` is the canonical, exhaustive index
├── source/                       ← own-scope PDFs + .md sidecars only (product-scope sources)
├── extraction.json               ← INPUT + OUTPUT (mutated for resolved flags)
└── annotations.json              ← INPUT + OUTPUT (status updated per flag)

{category}/{vendor}/{product-line}/source/    ← line-scope PDFs + sidecars (referenced from product MD as ../source/<file>)
{category}/{vendor}/source/                   ← category-scope PDFs + sidecars (referenced as ../../source/<file>)
```

Source enumeration is driven by the product MD's `sources:` frontmatter — never by walking `source/` directories. PDFs live at exactly one physical location (the highest scope where applicable) and are referenced via relative `local:` paths from the manifest.

## When to invoke

- After a user flags one or more fields in the viewer with `type: flag`.
- When you want to address a batch of flags on a single product.

Do NOT invoke for:
- Re-extracting an entire product — that's `extract-product`.
- Cohort verification sweeps — that's `cross-check-extraction` (deprioritized; not part of pipeline today).
- Processing `type: note` annotations — those are informational and stay untouched.

## Inputs

1. **`product_dir`** (preferred) — absolute path to the product directory containing `{slug}.md` + `annotations.json` + `extraction.json` (own-scope `source/` is product-scope only; line- and category-scope sources are referenced from `{slug}.md`'s `sources:` frontmatter as `../source/...` and `../../source/...`).
2. OR **`slug`** — the product's slug (`r770`, `dl380-gen12`, etc.). The skill resolves to the dir by walking the repo for an `extraction.json` with that slug.

## The flag → outcome mapping

The user's flag carries `field_path`, `text` (their reasoning), `created_at`. Treat the user's text as a **hypothesis to verify against the source**, not a verdict. Three possible outcomes per flag:

| Outcome | When | Action on extraction.json | Annotation status | resolution_summary |
|---|---|---|---|---|
| **Update** | Source clearly supports a different value than current AND user's reasoning aligns with what the source says | Update the field with new value + new evidence object citing the quote; append to `extraction_metadata.spot_fix_log[]` | `resolved` | "Updated to <new value>. Source: <verbatim quote, ≤150 chars>. User reasoning aligned: <one-line>." |
| **Confirm-current** | Source supports the current value; user's reasoning is based on a misreading, outdated info, or a schema-rule they didn't know | No change | `wont-fix` | "Current value <X> confirmed by source: <quote>. <One-line on why user's reading differs>." |
| **Ambiguous** | Source is silent on the field, contradicts itself, or the agent's confidence in either Update or Confirm-current is < 0.7 | No change | `open` (unchanged) | "Agent analysis: <findings>. Recommend: <human action — re-read source X, ask vendor, etc.>." |

**Confidence floor:** if the agent can't reach ≥ 0.7 confidence on Update or Confirm-current, fall back to Ambiguous. Don't make uncertain mutations — let the human decide.

## Process

### 1. Read annotations.json

Build the work list. Filter:

| status × type | Action |
|---|---|
| open + flag | Process per outcome mapping above |
| open + note | **Skip** — log "skipped (informational note)" |
| resolved (any) | Skip |
| wont-fix (any) | Skip |

If no `open + flag` items remain after filtering (notes-only or all already settled), write a brief "no work" report and exit cleanly. **Do not touch `extraction.json` or `annotations.json`** — leave both byte-identical.

### 2. For each open flag

a. **Locate the field in `extraction.json` via `field_path`:**
   - Top-level scalar: `ocp_slot_count` → `extraction.ocp_slot_count`
   - Top-level list: `processor_family` → `extraction.processor_family`
   - Subarray row: `cpu_skus[3]` → `extraction.cpu_skus[3]` (entire row — flag means "something in this row is wrong")
   - Subarray cell: `cpu_skus[3].requires_dlc` → that specific cell
   - Nested under vendor_extensions: `vendor_extensions.lenovo.machine_types`
   - If the path doesn't resolve (extraction shape changed since flag was created), mark Ambiguous with summary "field_path '<path>' no longer resolves in extraction.json — schema may have changed since flag was created."

b. **Read user's `text`.** Their reasoning is the hypothesis. Don't accept it at face value; verify against source.

c. **Targeted source read.** Don't re-read entire docs, and don't walk `source/` blindly. Resolve which file to read in this order:
   - **Prefer the existing evidence record's `evidence.source`** for the flagged field in `extraction.json`. That value is a manifest `local:` path (e.g. `"../source/platform-introduction.md"`) and is read verbatim, relative to the product directory.
   - **If the spot-fix needs a source not previously cited** (or no evidence record exists yet), enumerate candidates from the product MD's frontmatter `sources:` list — that list is the canonical, exhaustive index of every source applying to this product (own-scope, line-scope via `../source/...`, category-scope via `../../source/...`). Pick the manifest entry whose `type` / `title` matches the field domain and read its `local_extraction` (`.md`) sidecar.
   - Never enumerate sources by `ls source/` — the manifest is the contract.

   Match field domain to source section:
   - `ocp_*`, `lom_*`, `dpu_*` → networking / OCP / I/O sections; grep for "OCP", "LOM", "BlueField", "DPU"
   - `cpu_skus[*]`, `processor_family`, `socket_count`, `memory_channels_per_socket` → CPU SKU tables
   - `supports_cxl`, `cxl_*`, `cxl_configurations` → CXL chapters / "CXL Memory" section
   - `gpu_*`, `supported_gpus[*]`, `gpu_form_factor_support[*]`, `max_gpu_power_w` → GPU / accelerator sections
   - `supported_dimms[*]`, `dimm_slots`, `max_memory_*` → memory subsystem
   - `pcie_*`, `riser_configs[*]`, `pcie_slots[*]` → PCIe expansion / slot map / riser config tables
   - `psu_*`, `dc_power_supported`, `max_psu_output_w` → power / PSU options
   - `drive_*`, `supported_drives[*]`, `boot_drives[*]`, `storage_controllers[*]` → storage configurations / drive support / boot media
   - `security_features` → security / hardening
   - `supported_os` → OS support / certification
   - Other: read source `.md` sidecars and grep for relevant terminology
   - Always cite the specific anchor + page when available, plus a verbatim quote ≤ 150 chars.

d. **Apply the outcome.** Build the evidence object for any Update. **`evidence.source` MUST equal the manifest's `local:` path verbatim** (consistent with `extract-product`) — e.g. `"../source/platform-introduction.md"` for a line-scope source, never a bare filename:
   ```json
   {
     "value": <new value>,
     "evidence": {
       "source": "<manifest local: path verbatim, e.g. ../source/platform-introduction.md>",
       "anchor": "<table caption or section heading>",
       "page": <Reducto page anchor if available>,
       "quote": "<verbatim, ≤150 chars>",
       "confidence": <≥ 0.7>
     },
     "spot_fix": {
       "annotation_id": "<id>",
       "old_value": <prior value, or null>,
       "fixed_at": "<ISO timestamp>"
     }
   }
   ```
   The `spot_fix` object preserves provenance — downstream consumers can detect spot-fixed fields.

### 3. Append to `extraction_metadata.spot_fix_log`

For every Update outcome, append one entry:
```json
{
  "annotation_id": "<id>",
  "field_path": "<path>",
  "old_value": <prior>,
  "new_value": <new>,
  "source_quote": "<quote>",
  "user_reasoning": "<annotation.text, ≤200 chars>",
  "fixed_at": "<ISO timestamp>"
}
```

If `extraction_metadata.spot_fix_log` doesn't exist, create it as an empty array first.

### 4. Update annotations.json

For each processed flag, set:
- `status` to `resolved` | `wont-fix` | (unchanged for Ambiguous)
- `resolution_summary` per the table above
- `resolved_at` to current ISO timestamp (when status flips away from `open`); leave null for Ambiguous

Do NOT delete annotations. The audit trail matters.

### 5. Write outputs

- Write `extraction.json` only if any Update happened, with 2-space indent. Match existing formatting style.
- Write `annotations.json` only if any annotation's `status` or `resolution_summary` changed in this run. Skip the write when no flags were processed (notes-only, all already-settled, etc.).

### 6. Report back

Under 250 words:

- **Processed:** N flags · M notes skipped
- **Outcomes:** X updated, Y confirmed-current (wont-fix), Z ambiguous (still open)
- **Per-annotation lines** (one each):
  - `<field_path>` [updated|wont-fix|ambiguous] — <one-line reason>
- **Files modified:** absolute paths to `extraction.json` and `annotations.json` (or "extraction.json unchanged" if no Updates)
- **Open work:** if any annotations remain open after this run (ambiguous outcomes), explicitly list them so the human knows what still needs attention

## Constraints

- **Do not auto-mutate on low confidence.** Confidence floor 0.7 — below that, fall back to Ambiguous.
- **Do not touch `type: note` annotations.** They're informational; the user explicitly chose not to flag for review.
- **Do not delete annotations.** Status changes only.
- **Do not re-extract fields that aren't flagged.** Targeted only — don't go fishing.
- **Every Update must cite a specific source quote** in `evidence.quote` (verbatim, ≤ 150 chars). No paraphrasing.
- **Don't disagree silently with the user.** A wont-fix outcome must explain in `resolution_summary` why the source supports the current value despite the user's reasoning.
- **Don't modify schema files.** This skill operates on extractions, not schemas.

## Known failure modes

| Failure | Cause | Workaround |
|---|---|---|
| `field_path` doesn't resolve | Schema or extraction shape changed since the flag was created | Mark Ambiguous with note "path no longer resolves" |
| Source mentions both old and new values | Vendor doc is internally inconsistent (saw this in DL380 Gen12 with rev mismatches) | Mark Ambiguous; cite both quotes; recommend human picks |
| User's reasoning cites a value not in any source | User may have external knowledge | Mark Ambiguous; note "user-cited value not in extracted sources; may require additional source acquisition" |
| Multiple flags on related fields (e.g. `socket_count` + every `cpu_skus[*].family`) | User flagged a structural concern across rows | Process individually but cross-reference in resolution_summary; consistency-check before writing extraction.json |

## What this skill does NOT do

- Does not run extract-product (full extraction).
- Does not run cross-check-extraction (cohort verification).
- Does not modify schema files.
- Does not delete annotations.
- Does not process notes (`type: note`).
- Does not bulk-process across products — one product at a time. Caller invokes per product (parallel-safe across products since each writes only to its own dir).
