import { NextRequest, NextResponse } from "next/server";
import { isSupportedDocType, manualUpload } from "@/lib/pipeline/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 }
    );
  }
  const productSlug = String(formData.get("productSlug") ?? "").trim();
  const docType = String(formData.get("docType") ?? "").trim();
  const scope = String(formData.get("scope") ?? "own").trim();
  const url = formData.get("url") ? String(formData.get("url")) : null;
  const title = formData.get("title") ? String(formData.get("title")) : null;
  const file = formData.get("file");
  if (!productSlug || !docType) {
    return NextResponse.json(
      { error: "productSlug and docType required" },
      { status: 400 }
    );
  }
  if (!isSupportedDocType(docType)) {
    return NextResponse.json(
      { error: `unsupported docType: ${docType}` },
      { status: 400 }
    );
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const result = await manualUpload({
      productSlug,
      docType,
      scope,
      bytes,
      url,
      title,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
