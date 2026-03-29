import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "../domain/page.js";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const require = createRequire(import.meta.url);

/**
 * pdf.js concatenates `baseUrl + filename` then passes the result to `fs.readFile` in Node.
 * A `file://` URL breaks when the path contains spaces (`%20`), so we use a real filesystem
 * path with a trailing separator instead of `pathToFileURL` here.
 */
function dirPathWithTrailingSep(absDir: string): string {
  const normalized = absDir.replace(/[/\\]+$/, "");
  return `${normalized}${sep}`;
}

let pdfJsAssetBase: { standardFontDataUrl: string; cMapUrl: string } | null = null;

function getPdfJsAssetBase(): { standardFontDataUrl: string; cMapUrl: string } {
  if (!pdfJsAssetBase) {
    const pkgRoot = dirname(require.resolve("pdfjs-dist/package.json"));
    pdfJsAssetBase = {
      standardFontDataUrl: dirPathWithTrailingSep(join(pkgRoot, "standard_fonts")),
      cMapUrl: dirPathWithTrailingSep(join(pkgRoot, "cmaps")),
    };
  }
  return pdfJsAssetBase;
}

let pdfjsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  const pdfjs = await pdfjsPromise;
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  return pdfjs;
}

/** Items near the top or bottom of a page within this many PDF points are treated as headers/footers. */
const MARGIN_THRESHOLD = 50;

/** Max number of pages extracted concurrently within a single PDF (F10). */
const PAGE_CONCURRENCY = 8;

interface PdfTextItem {
  str?: string;
  transform?: number[];
}

function textFromContent(
  items: unknown[],
  pageHeight?: number,
  stripMargins = true
): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && "str" in item) {
      const { str, transform } = item as PdfTextItem;
      if (!str) continue;
      // PDF coordinate origin is bottom-left; transform[5] is the y-position.
      // Items near y≈0 (footer) or y≈pageHeight (header) are stripped when enabled.
      if (stripMargins && pageHeight !== undefined && transform) {
        const y = transform[5] ?? 0;
        if (y < MARGIN_THRESHOLD || y > pageHeight - MARGIN_THRESHOLD) continue;
      }
      parts.push(str);
    }
  }
  return parts.join(" ");
}

export interface ExtractOptions {
  /** Strip text items near page top/bottom margins (headers and footers). Default: true. */
  stripMargins?: boolean;
}

/**
 * Extract text per page (1-based page numbers).
 * Pages within a document are extracted concurrently in pools of up to PAGE_CONCURRENCY (F10).
 */
export async function extractPages(pdfPath: string, options?: ExtractOptions): Promise<Page[]> {
  const { stripMargins = true } = options ?? {};
  const pdfjs = await loadPdfJs();
  const { standardFontDataUrl, cMapUrl } = getPdfJsAssetBase();
  const buf = await readFile(pdfPath);
  const data = new Uint8Array(buf);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
  });
  const doc = await loadingTask.promise;
  const num = doc.numPages;
  const pages: Page[] = [];

  for (let i = 0; i < num; i += PAGE_CONCURRENCY) {
    const batchNums = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, num - i) },
      (_, j) => i + j + 1
    );
    const batchPages = await Promise.all(
      batchNums.map(async (pageNum) => {
        const page = await doc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const text = textFromContent(
          content.items as unknown[],
          viewport.height,
          stripMargins
        );
        return { pageNumber: pageNum, text } as Page;
      })
    );
    pages.push(...batchPages);
  }

  return pages;
}
