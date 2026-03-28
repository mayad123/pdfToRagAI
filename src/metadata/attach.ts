import type { DocumentRef } from "../domain/document.js";
import type { ChunkMetadata } from "../domain/metadata.js";
import { deterministicChunkId } from "../utils/hash.js";

export function attachMetadata(
  doc: DocumentRef,
  page: number,
  chunkIndex: number
): ChunkMetadata {
  return {
    id: deterministicChunkId(doc.relativePath, page, chunkIndex),
    fileName: doc.fileName,
    filePath: doc.relativePath,
    page,
    chunkIndex,
  };
}
