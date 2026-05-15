import fs from "node:fs";
import path from "node:path";
import { listExtractions } from "./extractions";

export type AnnotationType = "flag" | "note";
export type AnnotationStatus = "open" | "resolved" | "wont-fix";

export interface Annotation {
  id: string;
  field_path: string;
  type: AnnotationType;
  text: string;
  created_at: string;
  status: AnnotationStatus;
  resolution_summary: string | null;
  resolved_at: string | null;
}

export interface AnnotationsFile {
  annotations: Annotation[];
}

function annotationsFilePathFor(extractionPath: string): string {
  return path.join(path.dirname(extractionPath), "annotations.json");
}

function readAnnotationsFromExtractionPath(extractionPath: string): AnnotationsFile {
  const fp = annotationsFilePathFor(extractionPath);
  if (!fs.existsSync(fp)) return { annotations: [] };
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.annotations)) return parsed as AnnotationsFile;
  } catch {
    // fallthrough
  }
  return { annotations: [] };
}

function findExtractionPath(slug: string): string | null {
  const exts = listExtractions();
  const match = exts.find((e) => e.slug === slug);
  return match ? match.source_path : null;
}

export function getAnnotationsPath(slug: string): string | null {
  const ep = findExtractionPath(slug);
  return ep ? annotationsFilePathFor(ep) : null;
}

export function readAnnotations(slug: string): AnnotationsFile {
  const ep = findExtractionPath(slug);
  if (!ep) return { annotations: [] };
  return readAnnotationsFromExtractionPath(ep);
}

export function writeAnnotations(slug: string, file: AnnotationsFile): void {
  const ep = findExtractionPath(slug);
  if (!ep) throw new Error(`No extraction found for slug: ${slug}`);
  const fp = annotationsFilePathFor(ep);
  fs.writeFileSync(fp, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/** Open-annotation count per slug across all extractions, for the listing page. */
export function annotationCountsBySlug(): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of listExtractions()) {
    const ann = readAnnotationsFromExtractionPath(e.source_path);
    const open = ann.annotations.filter((a) => a.status === "open").length;
    if (open > 0) m.set(e.slug, open);
  }
  return m;
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
