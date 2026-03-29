import { pipeline } from "@xenova/transformers";
import type { VectorSearchHit } from "../storage/types.js";

/** Cache loaded cross-encoder pipelines by model id (one per process lifetime). */
const _cache = new Map<string, Awaited<ReturnType<typeof pipeline>>>();

async function loadPipeline(modelId: string) {
  if (!_cache.has(modelId)) {
    _cache.set(modelId, await pipeline("text-classification", modelId));
  }
  return _cache.get(modelId)!;
}

/**
 * Re-rank `candidates` against `question` using a local cross-encoder model (F15 adjacent).
 *
 * Scores each (question, chunk.text) pair and returns the top `topK` by cross-encoder score.
 * Env: `PDF_TO_RAG_RERANK_MODEL` — Hugging Face model id (e.g. `cross-encoder/ms-marco-MiniLM-L-6-v2`).
 * Activated automatically in `searchQuery` when the env var is set; disabled by default.
 */
export async function rerankCandidates(
  question: string,
  candidates: VectorSearchHit[],
  topK: number,
  modelId: string
): Promise<VectorSearchHit[]> {
  if (candidates.length === 0) return [];
  const pipe = await loadPipeline(modelId);

  const scored = await Promise.all(
    candidates.map(async (hit) => {
      const result = await (pipe as (text: string, opts: { text_pair: string }) => Promise<unknown>)(
        question,
        { text_pair: hit.chunk.text }
      );
      // Output is [{label, score}] — for cross-encoders, take the first (and usually only) label's score.
      const output = Array.isArray(result) ? result[0] : result;
      const score =
        output && typeof output === "object" && "score" in output && typeof (output as { score: unknown }).score === "number"
          ? (output as { score: number }).score
          : 0;
      return { hit, score };
    })
  );

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ hit }) => hit);
}
