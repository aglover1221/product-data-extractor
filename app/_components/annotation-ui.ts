export type AnnotationType = "flag" | "note";
export type AnnotationStatus = "open" | "resolved" | "wont-fix";

export type Annotation = {
  id: string;
  field_path: string;
  type: AnnotationType;
  text: string;
  created_at: string;
  status: AnnotationStatus;
  resolution_summary: string | null;
  resolved_at: string | null;
};

export function annotationButtonMeta(annotations: Annotation[]) {
  const openCount = annotations.filter((a) => a.status === "open").length;
  const totalCount = annotations.length;
  const hasOpen = openCount > 0;
  const hasOpenFlag = annotations.some((a) => a.status === "open" && a.type === "flag");
  const hasOpenNote = annotations.some((a) => a.status === "open" && a.type === "note");

  const buttonClass = hasOpenFlag
    ? "bg-amber-400/20 text-amber-300 hover:bg-amber-400/30"
    : hasOpenNote
    ? "bg-blue-400/20 text-blue-300 hover:bg-blue-400/30"
    : totalCount > 0
    ? "text-white/40 hover:text-white/60 hover:bg-white/5 border border-white/10"
    : "text-white/20 hover:text-white/50 hover:bg-white/5";

  const title = hasOpen
    ? `${openCount} open · ${totalCount} total — click to view/add`
    : totalCount > 0
    ? `${totalCount} resolved — click to view`
    : "Add annotation";

  return { buttonClass, title, label: totalCount > 0 ? String(totalCount) : "⚐" };
}
