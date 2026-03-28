import { join } from "node:path";

export const DEFAULT_CHUNK_SIZE = 512;
export const DEFAULT_CHUNK_OVERLAP = 64;
export const DEFAULT_STORE_DIR = ".pdf-to-rag";
export const DEFAULT_INDEX_FILE = "index.json";
export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_TOP_K = 5;
export const DEFAULT_RECURSIVE = true;

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
    ...overrides,
  };
}
