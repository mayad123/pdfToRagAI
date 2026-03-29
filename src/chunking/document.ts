import type { Chunk } from "../domain/chunk.js";
import type { DocumentRef } from "../domain/document.js";
import { attachMetadata } from "../metadata/attach.js";

export interface PageText {
  pageNumber: number;
  text: string;
}

interface PageOffsetEntry {
  pageNumber: number;
  startOffset: number;
}

/** Returns the page number whose text contains the given character offset. */
function pageForOffset(offset: number, offsets: PageOffsetEntry[]): number {
  let page = offsets[0]?.pageNumber ?? 1;
  for (const entry of offsets) {
    if (offset >= entry.startOffset) page = entry.pageNumber;
    else break;
  }
  return page;
}

/**
 * Chunk an entire document as one continuous text, allowing chunks to span
 * page boundaries (page boundary buffer feature).
 *
 * Each chunk is assigned the page where its first character appears.
 */
export function chunkDocumentText(
  pages: PageText[],
  doc: DocumentRef,
  options: { chunkSize: number; overlap: number }
): Chunk[] {
  const PAGE_SEP = "\n\n";
  const pageOffsets: PageOffsetEntry[] = [];
  let combined = "";

  for (const { pageNumber, text } of pages) {
    if (text.length === 0) continue;
    pageOffsets.push({ pageNumber, startOffset: combined.length });
    combined += text + PAGE_SEP;
  }

  if (combined.length === 0) return [];

  const { chunkSize, overlap } = options;
  const chunks: Chunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < combined.length) {
    const rawEnd = Math.min(start + chunkSize, combined.length);
    let end = rawEnd;
    if (rawEnd < combined.length) {
      const lastSpace = combined.lastIndexOf(" ", rawEnd);
      if (lastSpace > start) end = lastSpace;
    }
    const text = combined.slice(start, end).trim();
    if (text.length > 0) {
      const page = pageForOffset(start, pageOffsets);
      chunks.push({
        text,
        pageNumber: page,
        metadata: attachMetadata(doc, page, chunkIndex),
      });
      chunkIndex += 1;
    }
    if (rawEnd >= combined.length) break;
    let next = rawEnd - overlap;
    if (next <= start) next = rawEnd;
    start = next;
  }

  return chunks;
}
