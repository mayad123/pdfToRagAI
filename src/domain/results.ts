export interface IngestResult {
  filesProcessed: number;
  pagesProcessed: number;
  chunksIndexed: number;
  storePath: string;
}

export interface QueryHit {
  text: string;
  fileName: string;
  page: number;
  score: number;
  chunkId: string;
}

export interface InspectResult {
  storePath: string;
  chunkCount: number;
  files: string[];
}
