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
    const end = Math.min(start + chunkSize, cleanedText.length);
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
    if (end >= cleanedText.length) break;
    let next = end - overlap;
    if (next <= start) next = end;
    start = next;
  }

  return chunks;
}
