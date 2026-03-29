import type { PdfToRagConfig } from "../config/defaults.js";
import type { QueryHit } from "../domain/results.js";
import type { Embedder } from "../embeddings.js";
import type { VectorStore } from "../storage/types.js";
import { mmrSelect } from "./mmr.js";
import { rerankCandidates } from "./rerank.js";

/** Trim and collapse whitespace so pasted NL questions embed consistently. */
export function normalizeQueryText(question: string): string {
  return question.trim().replace(/\s+/g, " ");
}

/**
 * Semantic search: embeds a natural-language question and ranks stored chunks by cosine similarity.
 * When config.mmr is true, applies Maximal Marginal Relevance reranking for diversity (F14).
 * When hypotheticalAnswer is provided (HyDE, F15), it is embedded with "passage" role in place
 * of the question — improving alignment for short or abstract queries.
 * Not keyword-only matching; `text` in each hit is the verbatim stored chunk string.
 */
export async function searchQuery(
  question: string,
  config: PdfToRagConfig,
  embedder: Embedder,
  store: VectorStore,
  minScore?: number,
  hypotheticalAnswer?: string
): Promise<QueryHit[]> {
  await store.load();
  const q = normalizeQueryText(question);
  if (q.length === 0) {
    return [];
  }

  let queryVector: number[];
  if (hypotheticalAnswer && hypotheticalAnswer.trim().length > 0) {
    // HyDE (F15): embed the caller-supplied hypothetical answer as a passage so the query vector
    // lives in the same embedding space as stored chunks, closing the query-to-passage gap.
    queryVector = await embedder.embedOne(hypotheticalAnswer.trim(), "passage");
  } else {
    // Standard path: embed the question with "query" role (F11 asymmetric prefixes apply).
    queryVector = await embedder.embedOne(q, "query");
  }

  // Cross-encoder reranking supersedes MMR when PDF_TO_RAG_RERANK_MODEL is set (Phase 5).
  const rerankModel = process.env.PDF_TO_RAG_RERANK_MODEL?.trim() || undefined;

  // Determine how many cosine candidates to retrieve before the ranking/reranking stage.
  const candidateK = rerankModel
    ? config.rerankTopN
    : config.mmr
    ? config.topK * 3
    : config.topK;
  const candidates = store.search(queryVector, candidateK, minScore);

  let hits;
  if (rerankModel && candidates.length > 0) {
    // Cross-encoder reranking: score each (question, chunk) pair with a second model.
    hits = await rerankCandidates(q, candidates, config.topK, rerankModel);
  } else if (config.mmr) {
    hits = mmrSelect(candidates, queryVector, config.topK, config.mmrLambda);
  } else {
    hits = candidates;
  }

  return hits.map(({ chunk, score }) => ({
    text: chunk.text,
    fileName: chunk.metadata.fileName,
    page: chunk.metadata.page,
    score,
    chunkId: chunk.metadata.id,
  }));
}
