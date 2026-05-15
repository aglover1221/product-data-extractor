import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { getProductSourceDir } from "@/lib/extractions";

const SAFE_SEGMENT = /^[a-z0-9._-]+$/i;
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
  { params }: { params: { slug: string; name: string[] } }
) {
  const segments = params.name;
  if (!segments?.length) return new Response("not found", { status: 404 });
  for (const s of segments) {
    if (!SAFE_SEGMENT.test(s)) return new Response("invalid segment", { status: 400 });
  }
  const last = segments[segments.length - 1];
  if (!ALLOWED_EXT.test(last)) return new Response("invalid extension", { status: 400 });

  const dir = getProductSourceDir(params.slug);
  if (!dir) return new Response("not found", { status: 404 });

  const imagesRoot = path.join(dir, "images");
  const fp = path.join(imagesRoot, ...segments);
  if (!fp.startsWith(imagesRoot + path.sep) && fp !== imagesRoot) {
    return new Response("forbidden", { status: 403 });
  }
  if (!fs.existsSync(fp)) return new Response("not found", { status: 404 });

  const buf = fs.readFileSync(fp);
  const ext = last.split(".").pop()!.toLowerCase();
  return new Response(buf, {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
