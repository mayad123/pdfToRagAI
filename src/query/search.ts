import type { PdfToRagConfig } from "../config/defaults.js";
import type { QueryHit } from "../domain/results.js";
import type { Embedder } from "../embeddings.js";
import type { VectorStore } from "../storage/types.js";

/** Trim and collapse whitespace so pasted NL questions embed consistently. */
export function normalizeQueryText(question: string): string {
  return question.trim().replace(/\s+/g, " ");
}

/**
 * Semantic search: embeds a natural-language question and ranks stored chunks by cosine similarity.
 * Not keyword-only matching; `text` in each hit is the verbatim stored chunk string.
 */
export async function searchQuery(
  question: string,
  config: PdfToRagConfig,
  embedder: Embedder,
  store: VectorStore
): Promise<QueryHit[]> {
  await store.load();
  const q = normalizeQueryText(question);
  if (q.length === 0) {
    return [];
  }
  const queryVector = await embedder.embedOne(q);
  const hits = store.search(queryVector, config.topK);
  return hits.map(({ chunk, score }) => ({
    text: chunk.text,
    fileName: chunk.metadata.fileName,
    page: chunk.metadata.page,
    score,
    chunkId: chunk.metadata.id,
  }));
}
