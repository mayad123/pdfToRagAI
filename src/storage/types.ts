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

export interface VectorStore {
  load(): Promise<void>;
  replaceAll(chunks: IndexedChunk[]): Promise<void>;
  search(queryVector: number[], topK: number): VectorSearchHit[];
  getChunkCount(): number;
  listSourceFiles(): string[];
}
