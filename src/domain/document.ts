/** Logical document reference before or during ingestion. */
export interface DocumentRef {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Path relative to the ingest root. */
  relativePath: string;
  fileName: string;
}
