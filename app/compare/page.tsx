import Link from "next/link";
import { listExtractions, getExtraction } from "@/lib/extractions";
import { diffExtractions } from "@/lib/pipeline/extraction-diff";
import ComparePicker, { type PickerOption } from "./_components/ComparePicker";
import DiffTable from "./_components/DiffTable";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { left?: string; right?: string };
}

export default function ComparePage({ searchParams }: PageProps) {
  const all = listExtractions();
  const options: PickerOption[] = all.map((s) => ({
    slug: s.slug,
    label: `${s.vendor || "—"} · ${s.model || s.slug}`,
    category: s.category,
  }));

  const leftSlug = (searchParams.left ?? "").trim() || null;
  const rightSlug = (searchParams.right ?? "").trim() || null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Compare</h1>
        <p className="text-sm text-white/60">
          Side-by-side diff of two structured product extractions. Pick a left and right product
          below — the diff walks every field, preserves per-value evidence, and highlights where
          confidence shifted between the two extractions.
        </p>
      </header>

      {options.length < 2 ? (
        <EmptyState count={options.length} />
      ) : (
        <>
          <ComparePicker options={options} leftSlug={leftSlug} rightSlug={rightSlug} />
          <CompareBody leftSlug={leftSlug} rightSlug={rightSlug} />
        </>
      )}
    </div>
  );
}

function CompareBody({
  leftSlug,
  rightSlug,
}: {
  leftSlug: string | null;
  rightSlug: string | null;
}) {
  if (!leftSlug || !rightSlug) {
    return (
      <div className="panel text-sm text-white/60">
        <p>Select a product for each side to see the diff.</p>
      </div>
    );
  }
  if (leftSlug === rightSlug) {
    return (
      <div className="panel text-sm text-white/60">
        <p>Pick two different products. Comparing a slug against itself is always a no-op.</p>
      </div>
    );
  }

  const left = getExtraction(leftSlug);
  const right = getExtraction(rightSlug);
  if (!left || !right) {
    return (
      <div className="panel text-sm text-rose-300/80">
        <p>
          Couldn't load one of the extractions:
          {!left ? ` "${leftSlug}"` : ""}
          {!right ? ` "${rightSlug}"` : ""}.
        </p>
        <p className="mt-2 text-white/50">
          <Link href="/compare">← reset picker</Link>
        </p>
      </div>
    );
  }
  if (
    typeof left.category === "string" &&
    typeof right.category === "string" &&
    left.category !== right.category
  ) {
    return (
      <div className="panel text-sm text-amber-200/80">
        <p>
          Cross-category comparison isn't supported. {leftSlug} is{" "}
          <code className="font-mono">{String(left.category)}</code> and {rightSlug} is{" "}
          <code className="font-mono">{String(right.category)}</code>.
        </p>
      </div>
    );
  }

  const diff = diffExtractions(left, right);
  return <DiffTable diff={diff} />;
}

function EmptyState({ count }: { count: number }) {
  return (
    <div className="panel text-sm text-white/60 space-y-2">
      <p>
        Compare needs ≥ 2 extractions on disk; currently {count} {count === 1 ? "exists" : "exist"}.
      </p>
      <p>
        Run the pipeline against a second product first — see{" "}
        <Link href="/pipeline/extract" className="underline">/pipeline/extract</Link>.
      </p>
    </div>
  );
}
