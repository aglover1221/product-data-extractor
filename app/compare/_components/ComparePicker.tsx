"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export interface PickerOption {
  slug: string;
  label: string;
  category: string;
}

interface Props {
  options: PickerOption[];
  leftSlug: string | null;
  rightSlug: string | null;
}

export default function ComparePicker({ options, leftSlug, rightSlug }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setSide = useCallback(
    (side: "left" | "right", slug: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (slug) {
        params.set(side, slug);
      } else {
        params.delete(side);
      }
      const qs = params.toString();
      router.push(qs ? `/compare?${qs}` : "/compare");
    },
    [router, searchParams]
  );

  const swap = useCallback(() => {
    if (!leftSlug || !rightSlug) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("left", rightSlug);
    params.set("right", leftSlug);
    router.push(`/compare?${params.toString()}`);
  }, [leftSlug, rightSlug, router, searchParams]);

  const optionsByCategory = groupByCategory(options);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <SideSelect
        label="Left"
        value={leftSlug}
        groups={optionsByCategory}
        excluded={rightSlug}
        onChange={(slug) => setSide("left", slug)}
      />
      <button
        type="button"
        onClick={swap}
        disabled={!leftSlug || !rightSlug}
        className="px-2 py-1 rounded text-xs border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08] disabled:opacity-40 disabled:hover:bg-white/[0.04]"
        title="Swap left and right"
      >
        ⇄ swap
      </button>
      <SideSelect
        label="Right"
        value={rightSlug}
        groups={optionsByCategory}
        excluded={leftSlug}
        onChange={(slug) => setSide("right", slug)}
      />
    </div>
  );
}

interface SideSelectProps {
  label: string;
  value: string | null;
  groups: Map<string, PickerOption[]>;
  excluded: string | null;
  onChange: (slug: string) => void;
}

function SideSelect({ label, value, groups, excluded, onChange }: SideSelectProps) {
  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-white/50">
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-white/10 bg-black/40 px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30 min-w-[280px]"
      >
        <option value="">— pick a product —</option>
        {Array.from(groups.entries()).map(([category, items]) => (
          <optgroup key={category} label={category}>
            {items.map((opt) => (
              <option
                key={opt.slug}
                value={opt.slug}
                disabled={excluded === opt.slug}
              >
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function groupByCategory(options: PickerOption[]): Map<string, PickerOption[]> {
  const out = new Map<string, PickerOption[]>();
  for (const opt of options) {
    const list = out.get(opt.category) ?? [];
    list.push(opt);
    out.set(opt.category, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
  return new Map(Array.from(out.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}
