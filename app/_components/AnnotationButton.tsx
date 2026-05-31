"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { annotationButtonMeta, type Annotation } from "./annotation-ui";

export type { Annotation } from "./annotation-ui";

const AnnotationPopover = dynamic(() => import("./AnnotationPopover"), { ssr: false });

export default function AnnotationButton({
  slug,
  fieldPath,
  annotations
}: {
  slug: string;
  fieldPath: string;
  annotations: Annotation[];
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { buttonClass, title, label } = annotationButtonMeta(annotations);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 4, left: rect.left });
    setOpen(true);
  }

  return (
    <span className="inline-block ml-1.5 align-middle">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className={`inline-flex items-center justify-center text-[10px] leading-none px-1 min-w-4 h-4 rounded transition ${buttonClass}`}
        title={title}
      >
        {label}
      </button>
      {open && anchor ? (
        <AnnotationPopover
          slug={slug}
          fieldPath={fieldPath}
          annotations={annotations}
          anchor={anchor}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </span>
  );
}
