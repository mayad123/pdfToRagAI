import { pipeline } from "@xenova/transformers";
import type { Embedder } from "./types.js";

function tensorToVector(data: unknown): number[] {
  if (data && typeof data === "object" && "data" in data) {
    const d = (data as { data: Float32Array | number[] }).data;
    return Array.from(d);
  }
  throw new Error("Unexpected embedding output shape");
}

/**
 * Local feature-extraction pipeline (downloads model on first use).
 */
export async function createTransformersEmbedder(modelId: string): Promise<Embedder> {
  const pipe = await pipeline("feature-extraction", modelId);

  async function embedOne(text: string): Promise<number[]> {
    const out = await pipe(text, { pooling: "mean", normalize: true });
    return tensorToVector(out);
  }

  async function embed(texts: string[]): Promise<number[][]> {
    const batchSize = 8;
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await Promise.all(batch.map((t) => embedOne(t)));
      result.push(...vectors);
    }
    return result;
  }

  return { embed, embedOne };
}
