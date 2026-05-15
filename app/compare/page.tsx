import Link from "next/link";

export default function ComparePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Compare</h1>
      <div className="panel text-sm text-white/60">
        <p>
          Comparison view is offline pending the new schema. The previous version was wired to the
          old DB tables, which were removed in the structured-extraction pivot.
        </p>
        <p className="mt-3">
          Once we have ≥2 extractions on disk, this page will be rebuilt to read{" "}
          <code className="font-mono">extraction.json</code> directly.
        </p>
        <p className="mt-3">
          <Link href="/">← back to extractions</Link>
        </p>
      </div>
    </div>
  );
}
