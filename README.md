# product-data-extractor

Studio for structured product data extraction. A Next.js viewer + orchestrator
that turns vendor PDFs into structured `extraction.json` per a schema you
define, with per-value source attribution (page, quote, confidence).

The viewer renders portfolio, schemas, source manifests, and extractions over
a configurable data root. The orchestrator drives a four-stage pipeline:

```
discover  →  pull-sources  →  parse (Reducto)  →  extract (Anthropic Batch)
```

Each stage writes back to the data tree and to a local SQLite db for
orchestrator state (runs, jobs, batch IDs, approvals).

## Getting started

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY and REDUCTO_API_KEY if you want to run the pipeline.
# The viewer works without either — it just reads the sample dataset.

npm install
npm run studio:init   # creates data/studio.db and applies all migrations
npm run dev           # viewer on http://localhost:3210
```

The orchestrator DB is versioned with numbered migrations under
[`lib/db/migrations/`](lib/db/migrations/). `studio:init` is a thin wrapper
over the migration runner — running against an existing DB only applies what
hasn't been applied yet.

```bash
npm run migrate          # apply all pending migrations
npm run migrate:status   # show applied / pending / drift (exits 1 if not clean)
```

To add a schema change, drop a new `lib/db/migrations/NNNN_short_name.sql`
file (incremented id, two- or three-digit-padded fine, four-digit preferred).
The runner picks it up on the next `migrate` / `studio:init` / app boot. See
[`lib/db/migrations.ts`](lib/db/migrations.ts) for the contract — applied
migrations are immutable; edits trigger a drift error.

Visit <http://localhost:3210>. With the bundled sample dataset you'll see one
server (Dell PowerEdge R770) under the `server` category.

## Pointing at your own data

Set `PRODUCT_MCP_DATA_DIR` in `.env`. Layout the studio expects:

```
{PRODUCT_MCP_DATA_DIR}/
├── schemas/
│   ├── _base.md
│   ├── {category}.md          # server.md, storage.md, hci.md, ...
│   └── overlays/*.md
└── {category}/                # server, storage, networking, hci, chassis,
    └── {vendor}/              #   software-defined-infrastructure
        └── {product-line}/
            ├── {product-line}.md
            └── {slug}/
                ├── {slug}.md
                ├── sources.yaml       # produced by pull-sources
                ├── source/            # PDFs + Reducto .md sidecars
                ├── extraction.json    # produced by extract
                └── annotations.json   # optional, flag UI
```

`extraction.json` carries per-value `evidence` blocks (`source`, `anchor`,
`page`, `quote`, `confidence`). See the sample at
`data/sample/server/dell/poweredge/r770/extraction.json` and the schema it
satisfies at `data/sample/schemas/server.md`.

## Running the extraction pipeline

API keys required. The pipeline costs real money (Anthropic + Reducto). The
`MAX_RUN_USD` env var caps any single submission.

```bash
# Dry run — estimate cost without calling the API
npm run extract-one -- --product server/dell/poweredge/r770 --dry-run

# Sync extraction — single Messages call, writes extraction.json on success
npm run extract-one -- --product server/dell/poweredge/r770

# Batch extraction — submit and poll
npm run extract-one -- --product server/dell/poweredge/r770 --mode batch
npm run worker     # in another terminal — polls every 30s
```

To run the orchestrator + worker together: `npm run dev:all`.

## Project layout

```
app/                  # Next.js app router pages
  page.tsx            # portfolio index
  products/[slug]/    # per-product detail, raw/parsed source views
  schemas/            # schema MD render
  pipeline/           # pipeline orchestration UI
  inbox/              # annotation inbox
  api/                # annotation + pipeline routes
lib/
  env.ts              # zod-validated env
  repo-walk.ts        # PRODUCT_MCP_DATA_DIR walking + KNOWN_CATEGORIES guard
  portfolio.ts        # category × vendor × line discovery
  extractions.ts      # extraction.json loading + summaries
  schema-md.ts        # schema markdown rendering
  sources.ts          # source manifest parsing
  annotations.ts      # annotation file I/O
  pipeline/           # discover, parse, extract, audit, spotfix orchestration
  integrations/       # anthropic, reducto, search clients
  prompts/            # formalized prompts per pipeline stage
  db/                 # studio orchestrator SQLite client + versioned migrations
  jobs/               # background job queue
worker/               # Anthropic Batch poll handler + Reducto handler
scripts/              # CLI entry points (audit, extract-one, init, seed)
data/sample/          # bundled sample dataset
```

## Contributing

PRs welcome. A few conventions:

- **Vendor-neutral code, vendor-specific data.** Anything Dell- or HPE-specific
  belongs in the data tree, not the code. The viewer + pipeline auto-discover
  categories and vendors from the directory layout.
- **Schemas drive extraction.** The extract pipeline walks the relevant schema
  MD top-to-bottom. New fields go in the schema first; the extractor follows.
- **Per-value evidence is load-bearing.** Every extracted scalar carries
  `evidence: { source, anchor, page, quote, confidence }`. Don't introduce
  fields that bypass this.
- **Path security.** Anything that resolves a user-controlled path must check
  `startsWith(REPO_ROOT)` to prevent escape.

## License

MIT — see [LICENSE](./LICENSE).
