import type { ChunkMetadata } from "./metadata.js";

/** Text segment from one page with attached metadata. */
export interface Chunk {
  text: string;
  pageNumber: number;
  metadata: ChunkMetadata;
}
