import type { Chunk } from "../domain/chunk.js";
import type { DocumentRef } from "../domain/document.js";
import type { PdfToRagConfig } from "../config/defaults.js";
import type { Embedder } from "../embeddings.js";
import type { IndexedChunk, VectorStore } from "../storage/types.js";
import { extractPages } from "../pdf/extract.js";
import { cleanPageText } from "../normalization/clean.js";
import { chunkPageText } from "../chunking/chunk.js";

export interface IngestPipelineResult {
  chunks: Chunk[];
  indexed: number;
  pagesProcessed: number;
}

/**
 * files → pages → cleaned text → chunks → embeddings → storage (caller handles persist).
 */
export async function runIngestPipeline(
  docs: DocumentRef[],
  config: PdfToRagConfig,
  embedder: Embedder,
  store: VectorStore
): Promise<IngestPipelineResult> {
  const allChunks: Chunk[] = [];
  let pagesProcessed = 0;

  for (const doc of docs) {
    const pageList = await extractPages(doc.absolutePath);
    pagesProcessed += pageList.length;
    for (const page of pageList) {
      const cleaned = cleanPageText(page.text);
      const parts = chunkPageText(cleaned, page.pageNumber, doc, {
        chunkSize: config.chunkSize,
        overlap: config.chunkOverlap,
      });
      allChunks.push(...parts);
    }
  }

  const texts = allChunks.map((c) => c.text);
  const embeddings = await embedder.embed(texts);
  const indexed: IndexedChunk[] = allChunks.map((c, i) => ({
    id: c.metadata.id,
    text: c.text,
    embedding: embeddings[i]!,
    metadata: c.metadata,
  }));

  await store.replaceAll(indexed);

  return {
    chunks: allChunks,
    indexed: indexed.length,
    pagesProcessed,
  };
}
