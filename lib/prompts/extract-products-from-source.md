# Extract products from a line-level source

You are scanning a single line-level (or category-level) source MD — a Reducto-parsed vendor PDF that covers MULTIPLE products in one document — and identifying every individual product (SKU) the document covers. Your output is a structured JSON list the orchestrator uses to bootstrap product MD skeletons under `{category}/{vendor}/{line}/{slug}/`.

This prompt runs AFTER Reducto has produced the `.md` sidecar. You DO NOT fetch PDFs, run web search, or access external resources. Your only input is the sidecar text and a small product-line context block. Your only output is structured JSON.

---

## Inputs

- `category` — `server | storage | hci | networking | chassis | software-defined-infrastructure`
- `vendor` — `dell | hpe | lenovo` (lowercase)
- `product_line` — line slug (e.g. `n3200-on`, `connectrix`, `powerstore`)
- `source_path` — manifest path of the `.md` sidecar
- `source_body` — the sidecar's body text

Examples of line-level / family-shared docs:
- N3200-ON spec sheet covers 9 SKUs (e.g. N3208PX-ON, N3224F-ON, N3248P-ON, …)
- S5200-ON spec sheet covers 5 SKUs (S5212F-ON, S5224F-ON, S5232F-ON, S5248F-ON, S5296F-ON)
- Connectrix DS-7700B family covers DS-7710B / DS-7720B / DS-7730B
- PowerEdge brochure may enumerate every R-series / T-series / XR / XE platform

## What counts as a product

Use the vendor's own naming verbatim. A "product" is what the vendor markets as a separately-orderable SKU within the product line — distinct model numbers like `Z9332F-ON` or `R770`, not workload variants like "GPU-optimized" or "edge-ready" within a single SKU.

For each product captured:
- `slug` — lowercase, hyphenated, product-line prefix dropped where natural. PowerEdge R770 → `r770`. PowerSwitch Z9332F-ON → `z9332f-on`. Connectrix DS-7720B → `ds-7720b`.
- `model_number` — the vendor's full model identifier verbatim (e.g. `Z9332F-ON`, `R770`, `DS-7720B`).
- `marketing_name` — the vendor's full canonical name (e.g. `Dell PowerSwitch Z9332F-ON`, `PowerEdge R770`, `Dell Connectrix DS-7720B`).
- `evidence_anchor` — section heading or table caption where the model first surfaces.
- `evidence_quote` — verbatim ≤150-char quote from the source confirming the product is named.
- `confidence` — 0.0–1.0; ≥0.7 required to surface for user approval.

## What NOT to capture

- Workload variants of one SKU (e.g. "PowerEdge R770 GPU-optimized" → still `r770`).
- Form-factor breakouts within a SKU (e.g. "R770 with rear storage" → still `r770`).
- Software-only products mentioned tangentially.
- "Up to" / capability statements that aren't naming a specific SKU.
- Products from other product lines mentioned for comparison.
- Discontinued / EOL models if the source mentions them only in a "previous generation" sidebar.

## Confidence floor

If the model number's existence is asserted only via a passing mention (no spec-sheet column, no comparison-table row, no header-style anchor), set confidence < 0.7 and surface in `low_confidence` rather than `products`. The user will decide whether to approve.

## Slug normalization rules

1. Lowercase.
2. Hyphenate (no spaces, no slashes, no underscores).
3. Drop the product-line prefix only when natural — `PowerEdge R770` → `r770` (drop `poweredge-`), but `PowerSwitch Z9332F-ON` → `z9332f-on` (don't drop `powerswitch-` since `z9332f-on` is already the canonical slug everyone uses).
4. Preserve generation suffixes (`r770` not `r7-70`; `dl380-gen12` not `dl380gen12`).
5. Preserve hardware-type suffixes (`f-on`, `p-on`, `pxe-on` for PowerSwitch).

## Output format

Return a SINGLE JSON object as the assistant's final text. Schema:

```json
{
  "category": "networking",
  "vendor": "dell",
  "product_line": "powerswitch-n",
  "source_path": "../source/n3200-on-spec-sheet.md",
  "products": [
    {
      "slug": "n3208px-on",
      "model_number": "N3208PX-ON",
      "marketing_name": "Dell PowerSwitch N3208PX-ON",
      "evidence_anchor": "Table 1. PowerSwitch N3200-ON Series Models",
      "evidence_quote": "N3208PX-ON | 8 ports | 90 W per port",
      "confidence": 0.95
    }
  ],
  "low_confidence": [
    {
      "slug": "n3000",
      "model_number": "N3000",
      "marketing_name": "Dell PowerSwitch N3000 (legacy)",
      "evidence_quote": "N3000-series compatibility note",
      "confidence": 0.4,
      "reason": "Mentioned only as legacy-compat reference, not as a current SKU"
    }
  ],
  "notes": ""
}
```

Hard rules:
- Every product has `evidence_anchor` and `evidence_quote` ≤150 chars.
- No invented products — every entry traces to a verbatim mention in the source.
- Slugs are unique within `products`.
- The first character of your response must be `{`. No surrounding prose, no markdown fences.
