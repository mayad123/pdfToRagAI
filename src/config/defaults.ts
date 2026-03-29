import { join } from "node:path";

export const DEFAULT_CHUNK_SIZE = 512;
export const DEFAULT_CHUNK_OVERLAP = 64;
export const DEFAULT_STORE_DIR = ".pdf-to-rag";
export const DEFAULT_INDEX_FILE = "index.json";
export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-mpnet-base-v2";
export const DEFAULT_TOP_K = 10;
export const DEFAULT_RECURSIVE = true;
export const DEFAULT_STRIP_MARGINS = true;
export const DEFAULT_CONTEXT_PREFIX = true;
export const DEFAULT_MMR = false;
export const DEFAULT_MMR_LAMBDA = 0.5;
export const DEFAULT_RERANK_TOP_N = 50;

export interface PdfToRagConfig {
  chunkSize: number;
  chunkOverlap: number;
  /** Directory for the vector index (created if missing). */
  storeDir: string;
  indexFileName: string;
  embeddingModel: string;
  topK: number;
  /** When true, discover PDFs in subfolders of the ingest root. */
  recursive: boolean;
  /** When true, strip text items near page top/bottom margins (headers and footers). */
  stripMargins: boolean;
  /** When true, prepend [Document: name | Page N] to passage embed inputs (F12). */
  contextPrefix: boolean;
  /** When true, apply Maximal Marginal Relevance reranking for result diversity (F14). */
  mmr: boolean;
  /** MMR trade-off: 1 = pure relevance, 0 = pure diversity (F14). */
  mmrLambda: number;
  /**
   * Number of cosine-ranked candidates passed to the cross-encoder when PDF_TO_RAG_RERANK_MODEL
   * is set. Re-ranking supersedes MMR when active. (Phase 5)
   */
  rerankTopN: number;
}

export function defaultStorePath(cwd: string, storeDir = DEFAULT_STORE_DIR): string {
  return join(cwd, storeDir, DEFAULT_INDEX_FILE);
}

export function defaultConfig(overrides: Partial<PdfToRagConfig> = {}): PdfToRagConfig {
  return {
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    storeDir: DEFAULT_STORE_DIR,
    indexFileName: DEFAULT_INDEX_FILE,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
    topK: DEFAULT_TOP_K,
    recursive: DEFAULT_RECURSIVE,
    stripMargins: DEFAULT_STRIP_MARGINS,
    contextPrefix: DEFAULT_CONTEXT_PREFIX,
    mmr: DEFAULT_MMR,
    mmrLambda: DEFAULT_MMR_LAMBDA,
    rerankTopN: DEFAULT_RERANK_TOP_N,
    ...overrides,
  };
}
