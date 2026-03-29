import type { ChunkMetadata } from "../domain/metadata.js";

export interface IndexedChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: ChunkMetadata;
}

export interface VectorSearchHit {
  chunk: IndexedChunk;
  score: number;
}

export interface SourceFileFingerprint {
  mtime: number;
  size: number;
}

export interface VectorStore {
  load(): Promise<void>;
  replaceAll(chunks: IndexedChunk[]): Promise<void>;
  /** Replace only the chunks belonging to the given relative file paths (F13). */
  replaceForFiles(
    relativePaths: string[],
    newChunks: IndexedChunk[],
    fingerprints: Record<string, SourceFileFingerprint>
  ): Promise<void>;
  search(queryVector: number[], topK: number, minScore?: number): VectorSearchHit[];
  getChunkCount(): number;
  listSourceFiles(): string[];
  getSourceFileFingerprints(): Record<string, SourceFileFingerprint>;
}
