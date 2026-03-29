import type { Chunk } from "../domain/chunk.js";
import { attachMetadata } from "../metadata/attach.js";
import type { DocumentRef } from "../domain/document.js";

export interface ChunkingOptions {
  chunkSize: number;
  overlap: number;
}

/**
 * Split page text into overlapping windows by character count.
 */
export function chunkPageText(
  cleanedText: string,
  pageNumber: number,
  doc: DocumentRef,
  options: ChunkingOptions
): Chunk[] {
  const { chunkSize, overlap } = options;
  if (cleanedText.length === 0) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < cleanedText.length) {
    const rawEnd = Math.min(start + chunkSize, cleanedText.length);
    // Snap to a word boundary so chunks don't split mid-word.
    let end = rawEnd;
    if (rawEnd < cleanedText.length) {
      const lastSpace = cleanedText.lastIndexOf(" ", rawEnd);
      if (lastSpace > start) end = lastSpace;
    }
    const text = cleanedText.slice(start, end).trim();
    if (text.length > 0) {
      const base = {
        text,
        pageNumber,
        metadata: attachMetadata(doc, pageNumber, chunkIndex),
      };
      chunks.push(base);
      chunkIndex += 1;
    }
    if (rawEnd >= cleanedText.length) break;
    let next = rawEnd - overlap;
    if (next <= start) next = rawEnd;
    start = next;
  }

  return chunks;
}
