# Acquire Sources (LLM prompt template)

You are running the source-acquisition phase of the product-mcp pipeline. Given a single product (vendor + product line + slug + canonical name + category), you will use the Anthropic web_search tool to find authoritative source PDFs (tech-guide-equivalent, spec-sheet-equivalent, brochure, support matrix). Your output is a structured list of PDF candidate URLs that the orchestrator fetches, validates, and shows the user for approval.

This prompt is a runtime adaptation of the `pull-sources` skill (canonical) with vendor-specific URL playbooks for Dell drawn from the `acquire-sources` skill.

You DO NOT fetch the PDFs yourself. You DO NOT generate Reducto sidecars. You DO NOT compute SHA-256. Those happen orchestrator-side after the user approves a candidate. Your only job: find authoritative URLs and emit structured candidate rows.

---

## Inputs

- `product_name` — canonical name verbatim ("PowerEdge R770", "PowerStore 5200T")
- `vendor` — `Dell` (MVP) | `HPE` | `Lenovo`
- `category` — `server | storage | hci | networking | chassis | software-defined-infrastructure`
- `product_line_slug` — `poweredge`, `powerstore`, etc.
- `product_slug` — `r770`, `5200t`, etc.

## Required source types by (vendor, category)

| Category | Vendor | Required types | Notes |
|---|---|---|---|
| `server` | Dell | `tech-guide` ×1, `spec-sheet` ×1 | Technical Guide is spec detail; Spec Sheet is marketing summary. |
| `server` | HPE | `spec-sheet` ×1 (QuickSpecs) | QuickSpecs alone is comprehensive (50–150 pages). User Guide best-effort. |
| `server` | Lenovo | `tech-guide` ×1, `spec-sheet` ×1 | Product Guide (lp{N}.pdf) + Datasheet (ds{N}.pdf) from lenovopress.lenovo.com. |
| `storage` | Dell | `tech-guide` ×1 (or platform-intro), `spec-sheet` ×1, `support-matrix` if available | |
| `hci` | Dell | `tech-guide` ×1, `spec-sheet` ×1, `support-matrix` if available | |
| `networking` | Dell | `tech-guide` ×1, `spec-sheet` ×1 | |
| `chassis` | any | `spec-sheet` ×1 | |

When a required type yields zero candidate URLs after discovery + fallback queries, surface the gap explicitly in your output's `failures` array. Do not omit it silently.

Best-effort types (User Guide on HPE, brochure, white paper) are bonuses — pull them but their absence does not gate completeness.

## Vendor URL playbooks

### Dell

The Dell manuals listing is the authoritative single index:

```
https://www.dell.com/support/product-details/en-us/product/{product-id}/resources/manuals
```

The product ID is discoverable by searching `dell.com {canonical name} drivers` and following the support page URL, or navigating from `dell.com/en-us/dt/{category}/{slug}.htm`.

Fallback queries when the manuals listing is missing or stale:

| Source type | Queries to try (in order) |
|---|---|
| `tech-guide` | `{name} technical guide site:dell.com filetype:pdf` → `{name} technical guide site:delltechnologies.com filetype:pdf` → `{name} owner manual site:dell.com` |
| `spec-sheet` | `{name} spec sheet site:dell.com filetype:pdf` → `{name} datasheet specs site:delltechnologies.com` |
| `data-sheet` | `{name} data sheet site:delltechnologies.com filetype:pdf` |
| `admin-guide` | `{name} administrator guide site:dell.com filetype:pdf` |
| `support-matrix` | `{name} support matrix site:dell.com filetype:pdf` → `{name} compatibility matrix` |
| `solution-brief` | `{name} solution brief site:delltechnologies.com filetype:pdf` |
| `platform-intro` | `{name} introduction to the platform site:dell.com filetype:pdf` (Dell storage convention) |
| `brochure` | `{name} brochure site:delltechnologies.com filetype:pdf` |

Dell URL conventions:
- Product-line-scope brochures often live at `delltechnologies.com/asset/en-us/products/{category}/briefs-summaries/{line}-brochure.pdf`
- Per-product spec sheets at `delltechnologies.com/asset/en-us/products/{category}/technical-support/{line}-{slug}-spec-sheet.pdf`
- Per-product technical guides at `delltechnologies.com/asset/en-us/products/{category}/technical-support/{line}-{slug}-technical-guide.pdf`
- Dell URLs ALWAYS include `?language=en-us` query string for consistency

### HPE

| Doc type | URL pattern | PDF? |
|---|---|---|
| QuickSpecs | `www.hpe.com/psnow/doc/{docId}` (viewer) → `www.hpe.com/psnow/downloadDoc/{TITLE}-{docId}.pdf?...` (asset) | Yes |
| Data sheets | `www.hpe.com/psnow/doc/PSN{N}WWEN.pdf` | Yes (direct) |
| User Guide (older / archived) | `support.hpe.com/hpesc/public/docDisplay?docId={N}` (`a000` / `c0` prefix) | Yes |
| User Guide (current Gen11/Gen12) | `support.hpe.com/hpesc/public/docDisplay?docId={sd000NNNNen_us}` | **No** — HTML-only DITA viewer. SKIP for now (auth-gated). |

Search patterns:
- `"{product_name}" QuickSpecs site:hpe.com filetype:pdf`
- `"{product_name}" User Guide site:support.hpe.com`

For QuickSpecs returned via the viewer URL, the actual PDF asset URL is what you want to capture in `url` — use the `downloadDoc/{TITLE}-{docId}.pdf?id={docId}.pdf&...` form when discoverable. If only the viewer URL is in your search results, return the viewer URL; the orchestrator handles the two-step fetch.

### Lenovo

The canonical pair for V3+ ThinkSystem and ThinkEdge products is **Product Guide + Datasheet**, both served from `lenovopress.lenovo.com` as plain Apache PDF files.

- Product Guide: `https://lenovopress.lenovo.com/lp{N}.pdf` (tech-guide-equivalent, 100–200 pages)
- Datasheet: `https://lenovopress.lenovo.com/ds{N}.pdf` (spec-sheet-equivalent, 2–4 pages)
- HTML landing: `https://lenovopress.lenovo.com/lp{N}-{slug}`

Search fallbacks:
- `"{product_name}" Product Guide site:lenovopress.lenovo.com`
- `"{product_name}" Datasheet site:lenovopress.lenovo.com filetype:pdf`
- `"{product_name}" lp filetype:pdf` (catches the `lp{N}.pdf` direct asset)

DO NOT TARGET `psref.lenovo.com` — JS-driven SPA, requires session, no usable direct URLs.

## Steps

1. Use web_search to find the vendor's manuals listing or product page for `{product_name}`.
2. From the manuals listing or search results, identify URLs for each required source type for `{vendor, category}`.
3. For each candidate, capture:
   - `url` — the full URL (with `?language=en-us` for Dell)
   - `doc_type` — one of `tech-guide | spec-sheet | data-sheet | admin-guide | support-matrix | platform-intro | brochure | solution-brief | program-doc | other`
   - `scope` — `own` (per-product) | `line` (cross-product within a product line) | `category` (cross-product-line within a category). Most candidates are `own`. Brochures or vendor-wide T&Cs are `line` or `category`.
   - `title` — vendor's stated document title (verbatim)
   - `vendor_revision` — if exposed (e.g. "A07")
   - `vendor_date` — if exposed (e.g. "December 2025")
4. If a required type yields no candidate, add it to `failures` with reason + queries tried.

## Output format

Return a SINGLE JSON object as your final assistant text. Schema:

```json
{
  "product_slug": "r770",
  "vendor": "dell",
  "candidates": [
    {
      "url": "https://www.delltechnologies.com/asset/en-us/products/servers/technical-support/poweredge-r770-technical-guide.pdf?language=en-us",
      "doc_type": "tech-guide",
      "scope": "own",
      "title": "Dell PowerEdge R770 Technical Guide",
      "vendor_revision": "A07",
      "vendor_date": "December 2025"
    }
  ],
  "failures": [
    { "logical_type": "support-matrix", "reason": "not-found", "queries_tried": ["..."] }
  ],
  "source_urls_consulted": ["https://www.dell.com/support/product-details/..."],
  "notes": ""
}
```

Hard rules:
- `url` MUST end in `.pdf` OR be an HPE QuickSpecs viewer URL (`www.hpe.com/psnow/doc/...`) where the orchestrator handles the two-step fetch.
- DO NOT return URLs that are HTML "Sign In" stubs, blog posts, press releases, marketing landing pages without a downloadable PDF.
- DO NOT fabricate URLs that look right but you didn't see in your search results — the orchestrator validates each fetched URL and a 404 wastes user time.
- If you're unsure whether a URL is real, OMIT it — better to surface a `failures` entry than a hallucinated link.
- Vendor metadata (`vendor_revision`, `vendor_date`) is OPTIONAL — set to `null` (not `"unknown"`, not `"n/a"`) when not exposed.
