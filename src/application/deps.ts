import type { PdfToRagConfig } from "../config/defaults.js";
import type { Embedder } from "../embeddings.js";
import type { VectorStore } from "../storage/types.js";

export interface AppDeps {
  config: PdfToRagConfig;
  embedder: Embedder;
  store: VectorStore;
}
