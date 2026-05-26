/**
 * Network egress validation for URLs that originate from LLM output or other
 * upstream-controlled sources, plus a size-capped fetch wrapper.
 *
 * The studio's source-acquisition flow takes URLs returned by the search-tool
 * LLM (`lib/integrations/search.ts:searchWithTool`) and feeds them directly
 * to `fetch` inside the worker process. Without the guards in this module,
 * an LLM tricked by prompt injection in a web-search result can drive the
 * worker into requesting:
 *
 *   - `http://169.254.169.254/latest/meta-data/iam/security-credentials/...`
 *     → AWS EC2 instance metadata (steals IAM credentials if running on EC2)
 *   - `http://[fd00:ec2::254]/...` → IPv6 IMDS variant
 *   - `http://localhost:5432/`, `http://127.0.0.1:6379/` → probe / pivot
 *     internal services on the worker host
 *   - `http://10.0.0.1/admin` → reach internal infrastructure
 *
 * And without `boundedFetch`'s streaming size cap, the raw
 * `await res.arrayBuffer()` calls in `pdf-validation.ts` and
 * `reducto.ts:downloadImage` will happily buffer multi-gigabyte responses,
 * OOMing the worker (DoS).
 *
 * Two surfaces:
 *   1. `validateUrlShape` / `validateUrlAsync` — synchronous + DNS-aware
 *      validators. Reject non-http(s) schemes, IP literals in private /
 *      reserved ranges, well-known localhost aliases, and (async) hostnames
 *      that resolve to those ranges.
 *   2. `boundedFetch` — fetch wrapper that runs the async validator, streams
 *      the response, aborts past `maxBytes`, and re-validates the final URL
 *      after redirects.
 *
 * Known limitation — DNS rebinding: between `validateUrlAsync` and the
 * actual `fetch`, a malicious DNS server can serve a different answer. True
 * defense requires resolving once, then pinning the request to that IP via
 * a custom dispatcher (undici Agent). Out of scope for this PR.
 */
import * as dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import * as net from "node:net";

/** Default maximum response body size — 50 MiB. */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
/** Default request timeout — 120 s. */
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface SafeUrlOptions {
  /** Allowed URL schemes. Default: `['http:', 'https:']`. */
  allowedSchemes?: readonly string[];
  /**
   * Optional host allowlist. When provided, the host must equal one of these
   * suffixes or end with `"." + suffix`. Leave undefined for pure deny-by-IP
   * (which is what the source-acquisition flow wants — vendor PDFs live on
   * many hosts).
   */
  allowedHostSuffixes?: readonly string[];
  /**
   * Skip DNS resolution. Use only when the host is independently trusted
   * (e.g. the well-known Reducto API base). The default is to resolve and
   * reject any private/reserved IPs in the answer.
   */
  skipDnsCheck?: boolean;
}

export type ValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * Synchronous URL shape + scheme + literal-IP check. Does NOT resolve DNS.
 *
 * Sufficient when the host is already an IP literal (we validate it) OR when
 * the caller is going to follow up with `validateUrlAsync`.
 */
export function validateUrlShape(
  input: string,
  options: SafeUrlOptions = {}
): ValidationResult {
  const allowedSchemes = options.allowedSchemes ?? ["http:", "https:"];
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid url" };
  }
  if (!allowedSchemes.includes(url.protocol)) {
    return { ok: false, reason: `scheme ${url.protocol} not allowed` };
  }
  // WHATWG URL keeps IPv6 literals in bracket form on .hostname (e.g. "[::1]");
  // strip them before the IP-shape checks.
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!host) return { ok: false, reason: "missing host" };
  if (isLocalhostName(host)) {
    return { ok: false, reason: `host ${host} is a localhost alias` };
  }
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      return { ok: false, reason: `host ${host} is a private/reserved IP` };
    }
  }
  if (options.allowedHostSuffixes && options.allowedHostSuffixes.length > 0) {
    const lower = host.toLowerCase();
    const allowed = options.allowedHostSuffixes.some((s) => {
      const sLower = s.toLowerCase();
      return lower === sLower || lower.endsWith("." + sLower);
    });
    if (!allowed) {
      return { ok: false, reason: `host ${host} not in allowlist` };
    }
  }
  return { ok: true, url };
}

/**
 * Full async validation: shape + DNS resolution. If the host is a name, the
 * resolved A/AAAA records are validated against the same deny-list — so a
 * hostname like `attacker.example.com` that A-records into `10.0.0.1` is
 * rejected.
 *
 * DNS rebinding caveat noted in the module header.
 */
export async function validateUrlAsync(
  input: string,
  options: SafeUrlOptions = {}
): Promise<ValidationResult> {
  const shape = validateUrlShape(input, options);
  if (!shape.ok) return shape;
  if (options.skipDnsCheck) return shape;
  const host = shape.url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host)) return shape; // literal already validated
  let records: LookupAddress[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch (err) {
    return {
      ok: false,
      reason: `dns lookup failed for ${host}: ${(err as Error).message}`,
    };
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      return {
        ok: false,
        reason: `host ${host} resolves to private/reserved ${rec.address}`,
      };
    }
  }
  return shape;
}

const LOCALHOST_NAMES: ReadonlySet<string> = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

export function isLocalhostName(host: string): boolean {
  return LOCALHOST_NAMES.has(host.toLowerCase());
}

/**
 * True for any IP literal that should not be reachable from user-supplied
 * fetches: loopback, link-local, RFC 1918, CGNAT, IETF reserved, multicast,
 * IPv6 ULA, IPv4-mapped IPv6 of any of the above. Unknown families are
 * treated as private (conservative).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b, c, d] = parts;
  if (a === 0) return true;                                       // 0.0.0.0/8
  if (a === 10) return true;                                      // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true;              // 100.64/10 CGNAT
  if (a === 127) return true;                                     // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;                        // 169.254/16 link-local (incl. AWS IMDS 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;               // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true;               // 192.0.0/24
  if (a === 192 && b === 0 && c === 2) return true;               // 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true;             // 192.88.99/24 6to4 anycast (deprecated)
  if (a === 192 && b === 168) return true;                        // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true;           // 198.18/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true;            // 198.51.100/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;             // 203.0.113/24 TEST-NET-3
  if (a >= 224 && a <= 239) return true;                          // 224.0.0.0/4 multicast
  if (a >= 240) return true;                                      // 240.0.0.0/4 reserved
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const norm = ip.toLowerCase().trim();
  if (norm === "::1" || norm === "::") return true;
  // ::ffff:a.b.c.d — IPv4-mapped; extract and recheck against IPv4 rules.
  if (norm.startsWith("::ffff:")) {
    const v4 = norm.slice("::ffff:".length);
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
    return true;
  }
  // ::a.b.c.d — IPv4-compatible (deprecated).
  if (/^::\d+\.\d+\.\d+\.\d+$/.test(norm)) {
    const v4 = norm.slice(2);
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
    return true;
  }
  if (/^fe[89ab][0-9a-f]?:/.test(norm)) return true;              // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{0,2}:/.test(norm)) return true;             // fc00::/7 unique local (fc/fd)
  if (/^ff[0-9a-f]{0,2}:/.test(norm)) return true;                // ff00::/8 multicast
  return false;
}

// ----------------------------------------------------------------------------
// boundedFetch
// ----------------------------------------------------------------------------

export interface BoundedFetchOptions extends SafeUrlOptions {
  /** Max response body size in bytes. Default: 50 MiB. */
  maxBytes?: number;
  /** Total request timeout in ms. Default: 120 s. */
  timeoutMs?: number;
  /** Request headers. */
  headers?: Record<string, string>;
  /** HTTP method. Default: GET. */
  method?: string;
  /** Body for non-GET requests. */
  body?: BodyInit;
  /** Redirect behavior. Default: 'follow'. The final URL is re-validated. */
  redirect?: "follow" | "manual" | "error";
}

export interface BoundedFetchResult {
  ok: boolean;
  status: number;
  buf: Buffer;
  contentType?: string;
  /** URL after any redirects. */
  finalUrl: string;
  error?: string;
}

/**
 * Fetch with URL validation + streaming size cap + timeout.
 *
 *   - Runs `validateUrlAsync` before sending the request.
 *   - Streams the response body chunk-by-chunk; aborts the moment cumulative
 *     bytes exceed `maxBytes` (no large-payload OOM).
 *   - Re-validates the FINAL URL after redirects — a 302 to
 *     `http://169.254.169.254/` is rejected even if the original URL passed.
 *
 * Never throws on URL / size / network errors — returns
 * `{ ok: false, error }`. Callers treat as a fetch failure.
 */
export async function boundedFetch(
  input: string,
  options: BoundedFetchOptions = {}
): Promise<BoundedFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const initialValidation = await validateUrlAsync(input, options);
  if (!initialValidation.ok) {
    return {
      ok: false,
      status: 0,
      buf: Buffer.alloc(0),
      finalUrl: input,
      error: initialValidation.reason,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: options.redirect ?? "follow",
      signal: controller.signal,
    });

    // Re-validate after redirect. fetch's res.url is the final URL.
    if (res.url && res.url !== input) {
      const finalValidation = await validateUrlAsync(res.url, options);
      if (!finalValidation.ok) {
        clearTimeout(timer);
        return {
          ok: false,
          status: res.status,
          buf: Buffer.alloc(0),
          finalUrl: res.url,
          error: `redirect target rejected: ${finalValidation.reason}`,
        };
      }
    }

    // Stream the body with a hard byte cap.
    const reader = res.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      const ab = await res.arrayBuffer();
      if (ab.byteLength > maxBytes) {
        return {
          ok: false,
          status: res.status,
          buf: Buffer.alloc(0),
          finalUrl: res.url ?? input,
          error: `body exceeded ${maxBytes} bytes`,
        };
      }
      return {
        ok: res.ok,
        status: res.status,
        buf: Buffer.from(ab),
        contentType: res.headers.get("content-type") ?? undefined,
        finalUrl: res.url ?? input,
      };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore — we're already in the error path
        }
        clearTimeout(timer);
        return {
          ok: false,
          status: res.status,
          buf: Buffer.alloc(0),
          finalUrl: res.url ?? input,
          error: `body exceeded ${maxBytes} bytes`,
        };
      }
      chunks.push(value);
    }

    clearTimeout(timer);
    return {
      ok: res.ok,
      status: res.status,
      buf: Buffer.concat(chunks, total),
      contentType: res.headers.get("content-type") ?? undefined,
      finalUrl: res.url ?? input,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      buf: Buffer.alloc(0),
      finalUrl: input,
      error: (err as Error).message,
    };
  }
}
