-- product-mcp-studio orchestrator schema
-- Discardable / rebuildable from filesystem state via scripts/seed-from-filesystem.ts.
-- Filesystem (PRODUCT_MCP_DATA_DIR) is canonical for schemas, sources, extraction.json.

-- =============================================================
-- Discovery (Wave 6)
-- =============================================================

CREATE TABLE IF NOT EXISTS discoveries (
  id              INTEGER PRIMARY KEY,
  vendor          TEXT NOT NULL,
  portfolio       TEXT NOT NULL,
  seed_url        TEXT,
  status          TEXT NOT NULL,                 -- pending | running | completed | failed
  raw_results     TEXT,                          -- JSON: raw search hits
  error           TEXT,
  started_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS discovered_products (
  id                INTEGER PRIMARY KEY,
  discovery_id      INTEGER NOT NULL REFERENCES discoveries(id) ON DELETE CASCADE,
  vendor            TEXT NOT NULL,
  product_line      TEXT NOT NULL,
  slug              TEXT NOT NULL,
  marketing_name    TEXT,
  candidate_url     TEXT,
  approval_status   TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  approved_at       TEXT
);

-- =============================================================
-- Sources (Wave 6)
-- =============================================================

CREATE TABLE IF NOT EXISTS source_candidates (
  id              INTEGER PRIMARY KEY,
  product_slug    TEXT NOT NULL,
  scope           TEXT NOT NULL,                 -- own | line | category
  doc_type        TEXT NOT NULL,                 -- tech-guide | spec-sheet | brochure | support-matrix | ...
  url             TEXT NOT NULL,
  status          TEXT NOT NULL,                 -- pending | approved | rejected | fetch-failed
  file_size       INTEGER,
  page_count      INTEGER,
  sha256          TEXT,
  fetched_at      TEXT,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id              INTEGER PRIMARY KEY,
  product_slug    TEXT NOT NULL,
  scope           TEXT NOT NULL,
  doc_type        TEXT NOT NULL,
  local_path      TEXT NOT NULL,                 -- relative to PRODUCT_MCP_DATA_DIR
  url             TEXT,
  sha256          TEXT,
  audit_status    TEXT,
  page_count      INTEGER,
  approved_at     TEXT NOT NULL,
  UNIQUE(product_slug, scope, local_path)
);

CREATE INDEX IF NOT EXISTS idx_sources_product ON sources(product_slug);

-- =============================================================
-- Parse runs (Wave 4)
-- =============================================================

CREATE TABLE IF NOT EXISTS parse_runs (
  id                INTEGER PRIMARY KEY,
  source_id         INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  source_path       TEXT NOT NULL,                -- redundant with sources.local_path; kept for orphan parses
  reducto_job_id    TEXT,
  status            TEXT NOT NULL,                -- queued | running | completed | failed
  output_md_path    TEXT,
  validation_json   TEXT,                         -- {tables, anchors, page_count, warnings[]}
  error             TEXT,
  started_at        TEXT NOT NULL,
  completed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_parse_status ON parse_runs(status);

-- =============================================================
-- Schemas (Wave 3 + Wave 7)
-- =============================================================

CREATE TABLE IF NOT EXISTS schemas (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,              -- e.g. server, san-block-array, hci, networking
  version             TEXT NOT NULL,              -- e.g. v1.0, v2026-05-04, v1.1
  content_md          TEXT NOT NULL,
  generated_from_json TEXT,                       -- JSON list of reference MD paths if generated
  parent_version_id   INTEGER REFERENCES schemas(id),
  status              TEXT NOT NULL DEFAULT 'active', -- draft | active | archived
  created_at          TEXT NOT NULL,
  UNIQUE(name, version)
);

CREATE INDEX IF NOT EXISTS idx_schemas_name ON schemas(name);

-- =============================================================
-- Extraction runs (Wave 1 / Wave 2 — the headline feature)
-- =============================================================

CREATE TABLE IF NOT EXISTS extraction_runs (
  id                  INTEGER PRIMARY KEY,
  batch_id            TEXT,                       -- Anthropic Batch API id; NULL for sync (one-product) runs
  schema_version_id   INTEGER REFERENCES schemas(id),
  schema_name         TEXT NOT NULL,              -- denormalized for quick filter
  schema_version      TEXT NOT NULL,              -- denormalized
  product_set_json    TEXT NOT NULL,              -- JSON list of product slugs
  status              TEXT NOT NULL,              -- queued | submitted | processing | completed | completed-with-errors | failed
  cost_estimate_usd   REAL,
  cost_actual_usd     REAL,
  request_count       INTEGER,
  success_count       INTEGER DEFAULT 0,
  fail_count          INTEGER DEFAULT 0,
  submitted_at        TEXT NOT NULL,
  completed_at        TEXT,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON extraction_runs(status);

CREATE TABLE IF NOT EXISTS extraction_results (
  id                    INTEGER PRIMARY KEY,
  run_id                INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
  product_slug          TEXT NOT NULL,
  status                TEXT NOT NULL,            -- queued | running | completed | failed
  output_path           TEXT,                     -- relative to PRODUCT_MCP_DATA_DIR (the extraction.json)
  error_message         TEXT,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  cache_read_tokens     INTEGER,
  cache_creation_tokens INTEGER,
  started_at            TEXT,
  completed_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_results_run ON extraction_results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_product ON extraction_results(product_slug);

-- =============================================================
-- Spot-fix (Wave 5)
-- =============================================================

CREATE TABLE IF NOT EXISTS spotfix_runs (
  id                INTEGER PRIMARY KEY,
  annotation_id     TEXT NOT NULL,                -- annotations.json carries its own id
  product_slug      TEXT NOT NULL,
  field_path        TEXT NOT NULL,
  before_value      TEXT,
  after_value       TEXT,
  rationale         TEXT,
  status            TEXT NOT NULL,                -- pending-review | accepted | rejected | failed
  accepted_by_user  INTEGER,                       -- 1 = user accepted; 0 = rejected; NULL = pending
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cost_usd          REAL,
  started_at        TEXT NOT NULL,
  completed_at      TEXT
);

-- =============================================================
-- Generic job queue
-- The worker polls this. Idempotent handlers keyed by type.
-- =============================================================

CREATE TABLE IF NOT EXISTS jobs (
  id                INTEGER PRIMARY KEY,
  type              TEXT NOT NULL,                -- anthropic-batch-poll | reducto-poll | pdf-fetch | ...
  payload_json      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  next_run_at       TEXT,                         -- ISO timestamp; NULL = run immediately
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_next ON jobs(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
