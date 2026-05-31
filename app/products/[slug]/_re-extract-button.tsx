"use client";

import dynamic from "next/dynamic";

const ReExtractButton = dynamic(() => import("@/app/_components/ReExtractButton"), {
  ssr: false,
  loading: () => (
    <span className="px-2 py-0.5 rounded text-[11px] bg-white/5 text-white/50 border border-white/10">
      Re-extract
    </span>
  )
});

export default ReExtractButton;
