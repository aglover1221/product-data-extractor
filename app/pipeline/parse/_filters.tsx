"use client";

import { useRouter, useSearchParams } from "next/navigation";

const STATUSES = ["all", "queued", "running", "completed", "failed", "unparsed"] as const;
type Status = (typeof STATUSES)[number];

export default function ParseFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const currentStatus = (params?.get("status") as Status) ?? "all";
  const currentSlug = params?.get("slug") ?? "";

  function setStatus(s: Status) {
    const next = new URLSearchParams(params?.toString());
    if (s === "all") next.delete("status");
    else next.set("status", s);
    router.push(`/pipeline/parse?${next.toString()}`);
  }

  function setSlug(v: string) {
    const next = new URLSearchParams(params?.toString());
    if (!v) next.delete("slug");
    else next.set("slug", v);
    router.push(`/pipeline/parse?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <div className="flex gap-1">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-2 py-0.5 rounded border text-[12px] ${
              currentStatus === s
                ? "border-white/40 bg-white/10 text-white"
                : "border-white/10 text-white/60 hover:text-white hover:border-white/20"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="filter by slug"
        defaultValue={currentSlug}
        onBlur={e => setSlug(e.target.value.trim())}
        onKeyDown={e => {
          if (e.key === "Enter") setSlug((e.target as HTMLInputElement).value.trim());
        }}
        className="px-2 py-1 rounded border border-white/10 bg-black/40 text-[12px] text-white/80 w-48"
      />
    </div>
  );
}
