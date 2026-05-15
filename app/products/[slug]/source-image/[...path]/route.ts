import fs from "node:fs";
import { NextRequest } from "next/server";
import { resolveProductSourcePath } from "@/lib/extractions";

const UP_TOKEN = "__";
const SAFE_PATH_SEGMENT = /^(__|[a-z0-9._-]+)$/i;
const ALLOWED_EXT = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml"
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string; path: string[] } }
) {
  const segments = (params.path ?? []).map((s) => decodeURIComponent(s));
  if (segments.length === 0) return new Response("not found", { status: 404 });
  for (const seg of segments) {
    if (!SAFE_PATH_SEGMENT.test(seg)) {
      return new Response("invalid path", { status: 400 });
    }
  }
  const last = segments[segments.length - 1];
  if (!ALLOWED_EXT.test(last)) {
    return new Response("invalid filename", { status: 400 });
  }

  const manifestPath = segments.map((s) => (s === UP_TOKEN ? ".." : s)).join("/");
  const fp = resolveProductSourcePath(params.slug, manifestPath);
  if (!fp) return new Response("not found", { status: 404 });

  const buf = fs.readFileSync(fp);
  const ext = last.split(".").pop()!.toLowerCase();
  return new Response(buf, {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
