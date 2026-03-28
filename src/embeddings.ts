export type { Embedder } from "./embedding/types.js";
export { createTransformersEmbedder } from "./embedding/transformers.js";
export { createOllamaEmbedder } from "./embedding/ollama.js";

import { createTransformersEmbedder } from "./embedding/transformers.js";

/** Default path: Transformers.js (same as `createTransformersEmbedder`). */
export async function createEmbedder(modelId: string) {
  return createTransformersEmbedder(modelId);
}
