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

function textFromContent(items: unknown[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && "str" in item) {
      const s = (item as { str?: string }).str;
      if (s) parts.push(s);
    }
  }
  return parts.join(" ");
}

/**
 * Extract text per page (1-based page numbers).
 */
export async function extractPages(pdfPath: string): Promise<Page[]> {
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
  const pages: Page[] = [];
  const num = doc.numPages;
  for (let i = 1; i <= num; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = textFromContent(content.items as unknown[]);
    pages.push({ pageNumber: i, text });
  }
  return pages;
}
