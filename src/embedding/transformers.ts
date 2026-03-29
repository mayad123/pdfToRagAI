import { pipeline } from "@xenova/transformers";
import type { Embedder, EmbedRole } from "./types.js";

function tensorToVector(data: unknown): number[] {
  if (data && typeof data === "object" && "data" in data) {
    const d = (data as { data: Float32Array | number[] }).data;
    return Array.from(d);
  }
  throw new Error("Unexpected embedding output shape");
}

/**
 * Apply role-based prefix from env vars (F11).
 * PDF_TO_RAG_QUERY_PREFIX / PDF_TO_RAG_PASSAGE_PREFIX, e.g. "query: " for E5 models.
 */
function applyRolePrefix(text: string, role?: EmbedRole): string {
  if (role === "query") {
    const prefix = process.env.PDF_TO_RAG_QUERY_PREFIX ?? "";
    return prefix ? prefix + text : text;
  }
  if (role === "passage") {
    const prefix = process.env.PDF_TO_RAG_PASSAGE_PREFIX ?? "";
    return prefix ? prefix + text : text;
  }
  return text;
}

/**
 * Local feature-extraction pipeline (downloads model on first use).
 */
export async function createTransformersEmbedder(modelId: string): Promise<Embedder> {
  const pipe = await pipeline("feature-extraction", modelId);

  async function embedOne(text: string, role?: EmbedRole): Promise<number[]> {
    const input = applyRolePrefix(text, role);
    const out = await pipe(input, { pooling: "mean", normalize: true });
    return tensorToVector(out);
  }

  async function embed(texts: string[], role?: EmbedRole): Promise<number[][]> {
    const batchSize = 8;
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await Promise.all(batch.map((t) => embedOne(t, role)));
      result.push(...vectors);
    }
    return result;
  }

  return { embed, embedOne };
}
