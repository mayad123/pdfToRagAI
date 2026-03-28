export type {
  DocumentRef,
  Page,
  Chunk,
  ChunkMetadata,
  IngestResult,
  QueryHit,
  InspectResult,
} from "./domain/index.js";

export {
  defaultConfig,
  defaultStorePath,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_STORE_DIR,
  DEFAULT_INDEX_FILE,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_TOP_K,
  DEFAULT_RECURSIVE,
  type PdfToRagConfig,
} from "./config/index.js";

export {
  createNoOpHooks,
  type Hooks,
  type BeforeIngestPayload,
  type AfterChunkingPayload,
  type AfterIndexingPayload,
  type BeforeQueryPayload,
} from "./hooks/index.js";

export type { AppDeps } from "./application/deps.js";
export { createAppDeps, runIngest, runQuery, runInspect } from "./application/index.js";

export type { Embedder } from "./embeddings.js";
export { createEmbedder, createTransformersEmbedder, createOllamaEmbedder } from "./embeddings.js";

export type { VectorStore, IndexedChunk, VectorSearchHit } from "./storage/index.js";
export { FileVectorStore } from "./storage/index.js";

export { runIngestPipeline, type IngestPipelineResult } from "./ingestion/index.js";
export { normalizeQueryText, searchQuery } from "./query/index.js";

export { listPdfFiles, extractPages } from "./pdf/index.js";
export { cleanPageText } from "./normalization/index.js";
export { chunkPageText, type ChunkingOptions } from "./chunking/index.js";
export { attachMetadata } from "./metadata/index.js";
export { deterministicChunkId, cosineSimilarity } from "./utils/index.js";
