/**
 * PDF fetch + validation.
 *
 * Given a URL: fetch it with the right header set (HPE Akamai-aware),
 * follow HPE's downloadDoc two-step when the URL points at a viewer page,
 * sniff the content type, count pages via pdf-parse, compute sha256, return
 * a structured result. Used by the source-acquisition phase to validate
 * LLM-suggested URLs before presenting them to the user as approval candidates.
 *
 * HPE Akamai TLS-fingerprint workaround:
 *   *.hpe.com discriminates on TLS fingerprint + header completeness. A bare
 *   curl with only User-Agent returns zero bytes. Real-browser-equivalent
 *   header set (Sec-Fetch-Dest/Mode/Site, Upgrade-Insecure-Requests, full
 *   Accept-Encoding, same-host Referer) is required. Documented in
 *   the `pull-sources` skill under "HPE / Akamai TLS-fingerprint
 *   workaround". If full-header fetch still fails on a given network, the
 *   caller can fall back to WebFetch upstream.
 *
 * HPE downloadDoc two-step:
 *   `www.hpe.com/psnow/doc/{docId}` returns the HTML viewer, NOT the PDF
 *   asset. The actual PDF URL appears in a `downloadDoc` link inside the
 *   viewer page body. We grep the response body for that URL and re-fetch
 *   it (with the viewer URL as Referer to satisfy Sec-Fetch-Site: same-origin).
 */
import crypto from "node:crypto";
import { boundedFetch, type BoundedFetchOptions } from "@/lib/safe-url";

/** Max PDF body — 100 MiB. Anything larger is almost certainly not a real
 *  data-sheet and risks OOM'ing the worker if streamed into memory. */
const MAX_PDF_BYTES = 100 * 1024 * 1024;

export interface PdfValidationResult {
  ok: boolean;
  fileSize: number;
  pageCount?: number;
  sha256?: string;
  contentType?: string;
  /** Raw bytes — caller writes them to disk on approve. */
  bytes?: Buffer;
  /** Final URL after any HPE downloadDoc indirection. */
  resolvedUrl?: string;
  error?: string;
}

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MIN_PDF_BYTES = 50 * 1024; // 50 KB per pull-sources skill rule

const HPE_HOST_RE = /^(?:[a-z0-9-]+\.)?hpe\.com$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

export function isHpeHost(url: string): boolean {
  return HPE_HOST_RE.test(hostOf(url));
}

/** Is the URL a www.hpe.com/psnow/doc/{docId} viewer page (not the PDF asset)? */
export function isHpeViewerUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.host.toLowerCase() !== "www.hpe.com") return false;
    return /^\/psnow\/doc\/[^/]+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Build the request header set for a URL. HPE hosts get the full
 * browser-equivalent set (Sec-Fetch-*, Upgrade-Insecure-Requests, full
 * Accept-Encoding, plus a same-host Referer). Other hosts get a simple
 * desktop UA + Accept.
 */
export function buildBrowserHeaders(
  url: string,
  options: { referer?: string; ua?: string } = {}
): Record<string, string> {
  const ua = options.ua ?? DESKTOP_UA;
  const referer = options.referer ?? defaultReferer(url);

  const baseHeaders: Record<string, string> = {
    "User-Agent": ua,
    "Accept-Language": "en-US,en;q=0.9",
  };

  if (isHpeHost(url)) {
    return {
      ...baseHeaders,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": referer ? "same-origin" : "none",
      "Upgrade-Insecure-Requests": "1",
      ...(referer ? { Referer: referer } : {}),
    };
  }

  return {
    ...baseHeaders,
    Accept: "application/pdf,*/*;q=0.8",
    ...(referer ? { Referer: referer } : {}),
  };
}

/**
 * Pick a sensible default Referer per the skill's "Sec-Fetch-Site: same-origin"
 * rule. For *.hpe.com hosts, pick a same-host root so the request looks like a
 * normal navigation.
 */
function defaultReferer(url: string): string | undefined {
  const host = hostOf(url);
  if (host === "www.hpe.com") return "https://www.hpe.com/";
  if (host === "support.hpe.com") return "https://support.hpe.com/hpesc/public/home/";
  if (HPE_HOST_RE.test(host)) return `https://${host}/`;
  return undefined;
}

/** Find a downloadDoc URL inside an HPE viewer HTML body. */
export function extractDownloadDocUrl(html: string): string | null {
  // Try absolute URL first — covers most viewer pages that ship the PDF link inline.
  const abs = html.match(
    /https?:\/\/(?:www\.)?hpe\.com\/[^"'<>\s]*downloadDoc\/[^"'<>\s]*/
  );
  if (abs) return abs[0];
  // Fall back to a relative path under /psnow/.
  const rel = html.match(/\/psnow\/downloadDoc\/[^"'<>\s]*/);
  if (rel) return `https://www.hpe.com${rel[0]}`;
  return null;
}

interface RawFetchResult {
  ok: boolean;
  status: number;
  buf: Buffer;
  contentType?: string;
  error?: string;
}

async function rawFetch(
  url: string,
  options: { timeoutMs?: number; ua?: string; referer?: string } = {}
): Promise<RawFetchResult> {
  // boundedFetch runs validateUrlAsync (scheme + DNS + IP deny-list) before
  // sending the request, streams the body with a hard size cap, and
  // re-validates the final URL after any redirects. The URL we receive here
  // can ultimately come from LLM output (lib/pipeline/sources.ts), so the
  // validation is load-bearing — without it, a poisoned web-search result
  // can drive this fetch into AWS IMDS / internal subnets.
  const result = await boundedFetch(url, {
    headers: buildBrowserHeaders(url, options),
    redirect: "follow",
    timeoutMs: options.timeoutMs ?? 120_000,
    maxBytes: MAX_PDF_BYTES,
  } as BoundedFetchOptions);
  if (result.error) {
    return {
      ok: false,
      status: result.status,
      buf: result.buf,
      contentType: result.contentType,
      error: `fetch failed: ${result.error}`,
    };
  }
  return {
    ok: result.ok,
    status: result.status,
    buf: result.buf,
    contentType: result.contentType,
  };
}

function looksLikePdf(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // %PDF magic at offset 0
  return (
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
  );
}

/**
 * Fetch a URL and validate it as a PDF. Returns the bytes on success so the
 * caller can persist them without a second fetch.
 *
 * Validation rules (from pull-sources):
 *   - file must start with %PDF magic
 *   - size > 50 KB (smaller usually = Akamai 403 stub or HTML "Sign In" stub)
 *   - pdf-parse must succeed and report ≥ 1 page
 *
 * HPE-aware: if the URL is a viewer page (www.hpe.com/psnow/doc/{docId}) OR
 * the first fetch returns HTML on an HPE host, attempt the downloadDoc
 * two-step automatically.
 */
export async function fetchAndValidatePdf(
  url: string,
  options: {
    timeoutMs?: number;
    ua?: string;
    referer?: string;
    /** Internal — set when re-entering after downloadDoc resolution. */
    _retryDepth?: number;
  } = {}
): Promise<PdfValidationResult> {
  const retryDepth = options._retryDepth ?? 0;

  // First fetch
  const r1 = await rawFetch(url, options);
  if (r1.error) {
    return { ok: false, fileSize: 0, error: r1.error };
  }
  if (!r1.ok) {
    return {
      ok: false,
      fileSize: r1.buf.byteLength,
      contentType: r1.contentType,
      error: `HTTP ${r1.status}`,
    };
  }

  // HPE viewer / HTML body indirection — try downloadDoc once.
  // We trigger the two-step when (a) URL is a known viewer URL, OR
  // (b) first fetch returned HTML/text on an HPE host.
  const responseLooksHtml =
    !looksLikePdf(r1.buf) &&
    (r1.contentType?.includes("text/html") ||
      r1.contentType?.includes("text/plain") ||
      r1.buf.byteLength < MIN_PDF_BYTES * 2);

  const shouldTryDownloadDoc =
    retryDepth === 0 &&
    isHpeHost(url) &&
    (isHpeViewerUrl(url) || responseLooksHtml);

  if (shouldTryDownloadDoc) {
    const html = r1.buf.toString("utf8");
    const assetUrl = extractDownloadDocUrl(html);
    if (assetUrl && assetUrl !== url) {
      // Re-fetch the asset URL with the viewer URL as Referer (same-host),
      // satisfying Sec-Fetch-Site: same-origin.
      return fetchAndValidatePdf(assetUrl, {
        ...options,
        referer: url,
        _retryDepth: retryDepth + 1,
      });
    }
    // No downloadDoc link found — fall through to standard validation
    // (which will fail the %PDF check; caller sees a clear "auth-gated" error).
  }

  return validatePdfBuffer(r1.buf, r1.contentType, url);
}

async function validatePdfBuffer(
  buf: Buffer,
  contentType: string | undefined,
  resolvedUrl: string
): Promise<PdfValidationResult> {
  const fileSize = buf.byteLength;

  if (fileSize < MIN_PDF_BYTES) {
    return {
      ok: false,
      fileSize,
      contentType,
      resolvedUrl,
      error: `file too small (${fileSize} bytes; expected > ${MIN_PDF_BYTES})`,
    };
  }

  if (!looksLikePdf(buf)) {
    return {
      ok: false,
      fileSize,
      contentType,
      resolvedUrl,
      error:
        "missing %PDF magic bytes (likely HTML/auth stub — for HPE Gen12 User Guides this is expected: html-only-dita-auth-gated)",
    };
  }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  let pageCount: number | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse") as (
      b: Buffer
    ) => Promise<{ numpages: number }>;
    const parsed = await pdfParse(buf);
    pageCount = parsed.numpages;
  } catch (err: any) {
    return {
      ok: false,
      fileSize,
      contentType,
      sha256,
      bytes: buf,
      resolvedUrl,
      error: `pdf-parse failed: ${err?.message ?? String(err)}`,
    };
  }

  if (!pageCount || pageCount < 1) {
    return {
      ok: false,
      fileSize,
      contentType,
      sha256,
      pageCount,
      bytes: buf,
      resolvedUrl,
      error: "PDF has zero pages",
    };
  }

  return {
    ok: true,
    fileSize,
    contentType,
    sha256,
    pageCount,
    bytes: buf,
    resolvedUrl,
  };
}
