# product-mcp viewer

A Next.js viewer for structured product extractions. Reads a directory of
per-product `extraction.json` files plus schema markdown and renders:

- A portfolio index grouped by category → vendor → product line
- Per-product detail pages with every extracted field, its source quote,
  page anchor, and confidence
- Schema markdown (base + overlays) with anchored links
- Source manifests (`sources.yaml` + product-MD frontmatter)
- An annotation inbox for flagging fields that need a closer look

The viewer is **vendor-neutral** — it discovers categories and vendors from
the directory tree at runtime. It ships with a tiny sample dataset (one Dell
PowerEdge R770 server) so a fresh clone boots out-of-the-box.

## Getting started

```bash
npm install
npm run dev
```

Visit <http://localhost:3210>. You should see one server (`r770`) under the
`server` category.

## Pointing at your own data

The viewer reads from `DATA_ROOT`, an environment variable resolved relative
to the project root. The default is `data/sample`. To point at your own
knowledgebase:

```bash
# .env.local (gitignored)
DATA_ROOT=/abs/path/to/your/data
```

Your data directory must match this layout:

```
{DATA_ROOT}/
├── schemas/
│   ├── _base.md
│   ├── {category}.md           # e.g. server.md, storage.md
│   └── overlays/
│       └── *.md
└── {category}/                 # e.g. server, storage, networking
    └── {vendor}/               # e.g. dell, hpe
        └── {product-line}/     # e.g. poweredge
            ├── {product-line}.md
            └── {slug}/         # e.g. r770
                ├── {slug}.md
                ├── extraction.json
                └── annotations.json   # optional
```

`extraction.json` is the structured payload. Each scalar field has an
`evidence` block (`source`, `anchor`, `page`, `quote`, `confidence`). See
the included `data/sample/server/dell/poweredge/r770/extraction.json` for
the canonical shape, and `data/sample/schemas/server.md` for the schema it
satisfies.

## Project layout

```
app/                  # Next.js app router pages
  page.tsx            # portfolio index
  products/[slug]/    # per-product detail, raw/parsed source views
  schemas/            # schema MD render
  discovery/          # discovery MD render (optional)
  inbox/              # annotation inbox
  api/annotations/    # annotation CRUD
lib/                  # data-layer helpers; all read DATA_ROOT
  repo-walk.ts        # DATA_ROOT definition + filesystem walking
  portfolio.ts        # category/vendor/line/product discovery
  extractions.ts      # extraction.json loading + summaries
  schema-md.ts        # schema markdown rendering
  sources.ts          # source manifest parsing
  annotations.ts      # annotation file I/O
data/sample/          # shipped sample dataset
```

## Contributing

PRs welcome. A few conventions:

- Keep the viewer **vendor-neutral**. Anything Dell- or HPE-specific belongs
  in the data, not the code.
- Don't add scripts that mutate the source data. The viewer is read-only by
  design; data is produced by external tooling.
- Path security: anything that resolves a user-controlled path must check
  `startsWith(DATA_ROOT)` to prevent escape. See `lib/extractions.ts`
  `resolveProductSourcePath` for the pattern.

## License

MIT — see [LICENSE](./LICENSE).
