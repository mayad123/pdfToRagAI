import type { Chunk } from "../domain/chunk.js";

export interface BeforeIngestPayload {
  rootPath: string;
  filePaths: string[];
}

export interface AfterChunkingPayload {
  chunks: Chunk[];
}

export interface AfterIndexingPayload {
  count: number;
}

export interface BeforeQueryPayload {
  /** Natural-language question or phrase as passed by the caller (before query normalization in `searchQuery`). */
  question: string;
}

export interface Hooks {
  beforeIngest: (payload: BeforeIngestPayload) => void | Promise<void>;
  afterChunking: (payload: AfterChunkingPayload) => void | Promise<void>;
  afterIndexing: (payload: AfterIndexingPayload) => void | Promise<void>;
  beforeQuery: (payload: BeforeQueryPayload) => void | Promise<void>;
}

export function createNoOpHooks(): Hooks {
  const noop = (): void => {};
  return {
    beforeIngest: noop,
    afterChunking: noop,
    afterIndexing: noop,
    beforeQuery: noop,
  };
}
