/**
 * First-page PDF screenshot.
 *
 * Used in the source-candidates UI so the user can eyeball whether a
 * candidate PDF really is the document the LLM claims it is — saves a click
 * vs. opening every URL in a new tab.
 *
 * Output: a base64 data URL (PNG). Small enough to inline in API JSON.
 *
 * pdf-to-png-converter is a heavy dep (uses canvas under the hood). Lazy
 * import so module load doesn't crash when the dep isn't installed yet.
 */

export interface ScreenshotResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export async function firstPageScreenshot(
  pdfBytes: Buffer,
  options: { maxWidthPx?: number } = {}
): Promise<ScreenshotResult> {
  const maxWidth = options.maxWidthPx ?? 600;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("pdf-to-png-converter");
    const fn: (
      buf: Buffer,
      opts: any
    ) => Promise<Array<{ content: Buffer; pageNumber: number }>> =
      mod.pdfToPng ?? mod.default ?? mod;
    const pages = await fn(pdfBytes, {
      pagesToProcess: [1],
      // viewportScale controls DPI — 1.0 ≈ screen DPI; we then cap by maxWidth
      viewportScale: 1.5,
      outputFolder: undefined,
      outputFileMask: undefined,
      strictPagesToProcess: false,
    });
    if (!pages.length || !pages[0]?.content) {
      return { ok: false, error: "pdf-to-png-converter returned no pages" };
    }
    const png = pages[0].content;
    // No resize step — the maxWidth knob is a soft hint; viewportScale: 1.5
    // produces ~ 600–800px wide output for typical letter pages, which fits
    // the candidate card. If we need true resize later, layer sharp on top.
    void maxWidth;
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    return { ok: true, dataUrl };
  } catch (err: any) {
    return {
      ok: false,
      error: `screenshot failed: ${err?.message ?? String(err)}`,
    };
  }
}
