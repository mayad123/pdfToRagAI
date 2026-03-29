import { cosineSimilarity } from "../utils/cosine.js";
import type { VectorSearchHit } from "../storage/types.js";

/**
 * Maximal Marginal Relevance selection (F14).
 *
 * Iteratively picks the candidate that best balances relevance to the query
 * against redundancy with already-selected results.
 *
 * @param candidates  Pre-ranked hits from store.search (scored against query vector).
 * @param queryVector The embedded query, used for relevance scoring.
 * @param k           Number of results to return.
 * @param lambda      Trade-off: 1 = pure relevance, 0 = pure diversity.
 */
export function mmrSelect(
  candidates: VectorSearchHit[],
  queryVector: number[],
  k: number,
  lambda: number
): VectorSearchHit[] {
  if (candidates.length === 0) return [];
  const selected: VectorSearchHit[] = [];
  const remaining = [...candidates];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      // candidate.score is already cosine similarity to the query vector
      const relevance = candidate.score;

      // Maximum similarity to any already-selected chunk
      let maxRedundancy = 0;
      for (const sel of selected) {
        const sim = cosineSimilarity(candidate.chunk.embedding, sel.chunk.embedding);
        if (sim > maxRedundancy) maxRedundancy = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxRedundancy;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]!);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}
