/**
 * Reducto integration — used by the parse phase (PDF -> .md sidecar).
 *
 * Reducto's parse API is async:
 *   1. POST /upload (multipart) -> { file_id }
 *   2. POST /parse_async with { document_url: file_id, options, advanced_options, experimental_options } -> { job_id }
 *   3. GET /job/{job_id} -> { status: "Pending"|"Processing"|"Completed"|"Failed", progress, result? }
 *   4. When status="Completed": result.result is { chunks?, url? } (large results live behind a presigned URL)
 *
 * The canonical settings here mirror `_reducto_parse.py` (the Python helper used by the
 * `pull-sources` skill). Don't drift these without a project-wide review.
 *
 * TODO[reducto-api-shape]: Validate exact URL shapes against https://docs.reducto.ai/.
 *   - The python helper uses https://platform.reducto.ai as the base; we mirror that.
 *   - `parse_async` payload: `{ document_url: file_id, options, advanced_options, experimental_options }`.
 *     If Reducto renames any of these in a future API version, update here.
 *   - Job polling response shape: `result.result` may be `{ chunks: [...] }` directly (small parses)
 *     or `{ url: "https://..." }` for large parses; we handle both.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { boundedFetch } from "@/lib/safe-url";

export const REDUCTO_API_BASE = "https://platform.reducto.ai";

/** Hard cap for an individual Reducto-supplied artifact (presigned result JSON
 *  or a single image crop). Image crops are recompressed to 1600px JPEG q85 in
 *  downloadImage, so realistic sizes are <2 MiB; 50 MiB is the conservative
 *  ceiling that still rejects accidental or malicious gigabyte responses. */
const MAX_REDUCTO_ARTIFACT_BYTES = 50 * 1024 * 1024;

export interface ReductoBlockBbox {
  page?: number;
  [k: string]: unknown;
}

export interface ReductoBlock {
  type?: string; // "Figure" | "Table" | "Page Number" | ...
  content?: string;
  bbox?: ReductoBlockBbox;
  image_url?: string;
  [k: string]: unknown;
}

export interface ReductoChunk {
  blocks?: ReductoBlock[];
  [k: string]: unknown;
}

export interface ReductoUsage {
  num_pages?: number;
  credits?: number;
}

export interface ReductoJobMeta {
  status: string;
  progress?: number;
  result?: {
    result?: {
      chunks?: ReductoChunk[];
      url?: string;
      pdf_url?: string;
      studio_link?: string;
      [k: string]: unknown;
    };
    usage?: ReductoUsage;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface ReductoParseConfig {
  htmlTables?: boolean;
  agenticOcr?: boolean;
  inlineFigures?: boolean;
  inlineTables?: boolean;
  pageMarkers?: boolean;
}

const DEFAULT_CONFIG: Required<ReductoParseConfig> = {
  htmlTables: true,
  agenticOcr: true,
  inlineFigures: true,
  inlineTables: true,
  pageMarkers: true,
};

function requireKey(): string {
  if (!env.REDUCTO_API_KEY) {
    throw new Error(
      "REDUCTO_API_KEY required (Wave 4 is unstubbed). Set REDUCTO_API_KEY in your env."
    );
  }
  return env.REDUCTO_API_KEY;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${requireKey()}` };
}

/**
 * Upload a PDF to Reducto. Returns the opaque `file_id` to feed into parse_async.
 * Uses a multipart/form-data body assembled with native `fetch` (no SDK).
 */
export async function uploadPdf(pdfPath: string): Promise<string> {
  const buf = fs.readFileSync(pdfPath);
  // Node 18+ has Blob/FormData/fetch globally. Use them.
  const form = new FormData();
  const blob = new Blob([buf], { type: "application/pdf" });
  form.append("file", blob, path.basename(pdfPath));

  const res = await fetch(`${REDUCTO_API_BASE}/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(`Reducto upload failed (${res.status}): ${txt}`);
  }
  const data = (await res.json()) as { file_id?: string };
  if (!data.file_id) {
    throw new Error(`Reducto upload returned no file_id: ${JSON.stringify(data)}`);
  }
  return data.file_id;
}

/**
 * Submit a parse_async job. Returns the job_id. Settings mirror `_reducto_parse.py`.
 */
export async function submitParse(
  pdfPath: string,
  config: ReductoParseConfig = {}
): Promise<{ jobId: string; fileId: string }> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const fileId = await uploadPdf(pdfPath);

  const payload = {
    document_url: fileId,
    options: { ocr_mode: merged.agenticOcr ? "agentic" : "standard" },
    advanced_options: {
      table_output_format: merged.htmlTables ? "html" : "markdown",
      add_page_markers: merged.pageMarkers,
    },
    experimental_options: {
      return_figure_images: merged.inlineFigures,
      return_table_images: merged.inlineTables,
    },
  };

  const res = await fetch(`${REDUCTO_API_BASE}/parse_async`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(`Reducto parse_async failed (${res.status}): ${txt}`);
  }
  const data = (await res.json()) as { job_id?: string };
  if (!data.job_id) {
    throw new Error(`Reducto parse_async returned no job_id: ${JSON.stringify(data)}`);
  }
  return { jobId: data.job_id, fileId };
}

/**
 * GET /job/{jobId} — poll status. Returns the raw meta block; caller maps
 * Reducto's `Pending|Processing|Completed|Failed` to studio statuses.
 */
export async function getJobStatus(jobId: string): Promise<ReductoJobMeta> {
  const res = await fetch(`${REDUCTO_API_BASE}/job/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const txt = await safeText(res);
    throw new Error(`Reducto job status failed (${res.status}): ${txt}`);
  }
  return (await res.json()) as ReductoJobMeta;
}

/**
 * Map Reducto's status string to studio's parse_runs.status enum.
 */
export function mapReductoStatus(
  s: string | undefined
): "queued" | "running" | "completed" | "failed" {
  if (!s) return "queued";
  const lower = s.toLowerCase();
  if (lower === "completed") return "completed";
  if (lower.startsWith("fail") || lower.startsWith("error")) return "failed";
  if (lower === "pending") return "queued";
  return "running";
}

/**
 * Once a job is Completed, fetch the parsed payload. Small parses ship `chunks`
 * inline; large parses return `url` (presigned) and we follow the redirect.
 */
export async function fetchJobResult(
  meta: ReductoJobMeta
): Promise<{
  chunks: ReductoChunk[];
  usage: ReductoUsage;
  pdfUrl?: string;
  studioLink?: string;
}> {
  const inner = meta.result?.result;
  if (!inner) {
    throw new Error("Reducto job meta has no result.result block");
  }
  let chunks: ReductoChunk[] | undefined = inner.chunks;
  if (!chunks || chunks.length === 0) {
    if (!inner.url) {
      throw new Error("Reducto returned no chunks and no result URL");
    }
    // inner.url is a presigned URL Reducto returns for large results. It's
    // upstream-controlled (compromised Reducto account / response-spoofing
    // angle), so we run it through boundedFetch — same URL deny-list and
    // size cap as the source-acquisition path.
    const r = await boundedFetch(inner.url, {
      maxBytes: MAX_REDUCTO_ARTIFACT_BYTES,
    });
    if (!r.ok || r.error) {
      throw new Error(
        `Reducto presigned-result fetch failed (${r.status}): ${r.error ?? r.buf.toString("utf8").slice(0, 1000)}`
      );
    }
    let body: { chunks?: ReductoChunk[] };
    try {
      body = JSON.parse(r.buf.toString("utf8")) as { chunks?: ReductoChunk[] };
    } catch (err) {
      throw new Error(
        `Reducto presigned-result parse failed: ${(err as Error).message}`
      );
    }
    chunks = body.chunks ?? [];
  }
  return {
    chunks,
    usage: meta.result?.usage ?? {},
    pdfUrl: typeof inner.pdf_url === "string" ? inner.pdf_url : undefined,
    studioLink: typeof inner.studio_link === "string" ? inner.studio_link : undefined,
  };
}

/**
 * Filter rules from the `pull-sources` skill step 6:
 *   - Drop crops with area < 5,000 px² or shortest side < 50 px
 *     (cuts NOTE-badge icons, page-number ornaments, decorative arrows).
 *   - PNG → JPEG q85, longest side capped at 1,600 px (~50% byte reduction).
 */
const MIN_AREA_PX2 = 5_000;
const MIN_SIDE_PX = 50;
const MAX_LONGEST_SIDE_PX = 1_600;
const JPEG_QUALITY = 85;

export interface DownloadImageResult {
  status: "kept" | "filtered" | "failed";
  /** Final bytes written (0 if filtered or failed). */
  bytes: number;
  /** Final on-disk extension after recompression (forced to .jpg when kept). */
  finalLocalName?: string;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Download a single Reducto image, filter by size, recompress to JPEG q85,
 * and write to disk. The longest side is capped at 1,600 px.
 *
 * Returns `status: "filtered"` (no write) for crops smaller than the skill
 * thresholds — these are decorative icons / page-number ornaments that have
 * no extraction value. The on-disk filename is rewritten to `.jpg`
 * regardless of source extension; `finalLocalName` is the basename the
 * caller should reference from the markdown.
 */
export async function downloadImage(
  url: string,
  destPath: string
): Promise<DownloadImageResult> {
  try {
    // url comes from Reducto's parse-result block.image_url — upstream-
    // controlled. Same boundedFetch contract as fetchJobResult: scheme + IP
    // deny-list + size cap. An unbounded fetch would let a malicious or
    // accidentally-huge image crop OOM the worker.
    const r = await boundedFetch(url, {
      maxBytes: MAX_REDUCTO_ARTIFACT_BYTES,
    });
    if (!r.ok || r.error) {
      return {
        status: "failed",
        bytes: 0,
        error: r.error ?? `HTTP ${r.status}`,
      };
    }
    if (r.buf.byteLength < 100) {
      return { status: "failed", bytes: r.buf.byteLength, error: "too small" };
    }

    // sharp is a heavy native dep; lazy-require so module load doesn't break
    // in non-image dev paths.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require("sharp") as (b: Buffer) => any;
    const image = sharp(r.buf);
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    // Filter: drop tiny crops and pencil-thin ornaments.
    const area = width * height;
    const shortestSide = Math.min(width, height);
    if (
      area < MIN_AREA_PX2 ||
      shortestSide < MIN_SIDE_PX ||
      width === 0 ||
      height === 0
    ) {
      return {
        status: "filtered",
        bytes: 0,
        width,
        height,
      };
    }

    // Resize so longest side ≤ MAX_LONGEST_SIDE_PX. sharp's withMetadata + JPEG
    // q85 recompress cuts byte count ~50% on PNG sources without visible loss.
    const longest = Math.max(width, height);
    const pipeline =
      longest > MAX_LONGEST_SIDE_PX
        ? image.resize({
            width: width >= height ? MAX_LONGEST_SIDE_PX : undefined,
            height: height > width ? MAX_LONGEST_SIDE_PX : undefined,
            fit: "inside",
          })
        : image;

    const jpegBuf: Buffer = await pipeline
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    // Force .jpg on disk regardless of source extension.
    const dir = path.dirname(destPath);
    const baseNoExt = path.basename(destPath).replace(/\.[^.]+$/, "");
    const finalAbs = path.join(dir, `${baseNoExt}.jpg`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(finalAbs, jpegBuf);

    return {
      status: "kept",
      bytes: jpegBuf.byteLength,
      finalLocalName: path.basename(finalAbs),
      width,
      height,
    };
  } catch (e) {
    return { status: "failed", bytes: 0, error: (e as Error).message };
  }
}

async function safeText(r: Response): Promise<string> {
  try {
    const t = await r.text();
    return t.slice(0, 1000);
  } catch {
    return "<no body>";
  }
}

// ----------------------------------------------------------------------------
// Markdown assembler — port of `_reducto_parse.py:build_md`.
// ----------------------------------------------------------------------------

const PAGE_RE = /\[\[\s*PAGE\s+\d+\s+BEGINS\s+HERE\s*\]\]/gi;

export interface AssembleResult {
  md: string;
  imageRefs: { url: string; localName: string; type: string; page: number }[];
}

/**
 * Assemble the markdown sidecar from Reducto chunks. Mirrors the python helper's
 * structure (page anchors, figure/table HTML, source-screenshot details blocks).
 */
export function assembleMarkdown(
  chunks: ReductoChunk[],
  usage: ReductoUsage,
  imgSubdir: string,
  pdfBasename: string
): AssembleResult {
  const out: string[] = [];
  out.push(`# ${pdfBasename} (parsed)`);
  out.push("");
  out.push(`- Reducto OCR mode: agentic`);
  out.push(`- Tables: HTML (\`table_output_format=html\`)`);
  out.push(`- Pages: ${usage.num_pages ?? "?"}`);
  out.push(`- Credits: ${usage.credits ?? "?"}`);
  out.push("");
  out.push("Each Table block is followed by its source screenshot for verification. Figure blocks render inline.");
  out.push("");
  out.push("---");
  out.push("");

  let lastPage: number | null = null;
  let idx = 0;
  const imageRefs: AssembleResult["imageRefs"] = [];

  for (const chunk of chunks) {
    for (const block of chunk.blocks ?? []) {
      const type = block.type ?? "";
      const rawContent = (block.content ?? "").trim();
      const content = rawContent.replace(PAGE_RE, "").trim();
      const bbox = block.bbox ?? {};
      const page =
        typeof bbox.page === "number" ? bbox.page : 0;

      if (type === "Page Number") continue;

      if (page && page !== lastPage) {
        out.push("");
        out.push(`<!-- page: ${page} -->`);
        out.push(
          `<div style="font-size: 0.7rem; color: rgba(255,255,255,0.35); margin: 1rem 0 0.4rem;">page ${page}</div>`
        );
        lastPage = page;
      }

      let localImage: string | null = null;
      if (block.image_url) {
        const safeType = (type || "block").toLowerCase().replace(/[^a-z0-9]/g, "_");
        const localName = `p${String(page).padStart(3, "0")}_${safeType}_${String(idx).padStart(4, "0")}.jpg`;
        imageRefs.push({
          url: block.image_url,
          localName,
          type,
          page,
        });
        localImage = localName;
      }
      idx++;

      if (type === "Figure") {
        if (localImage) {
          out.push(
            `<figure style="margin: 1rem 0; padding: 0.6rem; background: rgba(255,255,255,0.04); border-radius: 4px;">`
          );
          out.push(
            `  <img src="${imgSubdir}/${localImage}" alt="figure p${page}" style="max-width: 100%; max-height: 480px; display: block; margin: 0 auto;" />`
          );
          if (content) {
            out.push(
              `  <figcaption style="font-size: 0.78rem; color: rgba(255,255,255,0.55); text-align: center; margin-top: 0.5rem;">${content}</figcaption>`
            );
          }
          out.push(`</figure>`);
          out.push("");
        } else if (content) {
          out.push(`*${content}*`);
          out.push("");
        }
      } else if (type === "Table") {
        if (content) {
          out.push(content);
          out.push("");
        }
        if (localImage) {
          out.push(
            `<details style="margin: 0.3rem 0 1rem; padding: 0.4rem 0.6rem; background: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.08);">`
          );
          out.push(
            `  <summary style="cursor: pointer; font-size: 0.75rem; color: rgba(255,255,255,0.55);">view source screenshot for verification (page ${page})</summary>`
          );
          out.push(
            `  <img src="${imgSubdir}/${localImage}" alt="table source p${page}" style="max-width: 100%; margin-top: 0.6rem; display: block;" />`
          );
          out.push(`</details>`);
          out.push("");
        }
      } else {
        if (content) {
          out.push(content);
          out.push("");
        }
      }
    }
  }

  return { md: out.join("\n"), imageRefs };
}
