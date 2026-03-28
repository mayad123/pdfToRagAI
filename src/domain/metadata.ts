/** Citation-oriented metadata stored with each chunk. */
export interface ChunkMetadata {
  id: string;
  fileName: string;
  /** Relative to ingest root. */
  filePath: string;
  page: number;
  chunkIndex: number;
}
