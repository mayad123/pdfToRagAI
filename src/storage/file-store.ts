import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cosineSimilarity } from "../utils/cosine.js";
import type { IndexedChunk, VectorSearchHit, VectorStore } from "./types.js";

interface IndexFileV1 {
  version: 1;
  embeddingModel: string;
  chunks: IndexedChunk[];
}

export class FileVectorStore implements VectorStore {
  private chunks: IndexedChunk[] = [];

  constructor(
    private readonly indexPath: string,
    public readonly embeddingModel: string
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as IndexFileV1;
      if (parsed.version !== 1) {
        throw new Error(`Unsupported index version: ${String(parsed.version)}`);
      }
      this.chunks = parsed.chunks ?? [];
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        this.chunks = [];
        return;
      }
      throw e;
    }
  }

  async replaceAll(chunks: IndexedChunk[]): Promise<void> {
    this.chunks = chunks;
    await mkdir(dirname(this.indexPath), { recursive: true });
    const payload: IndexFileV1 = {
      version: 1,
      embeddingModel: this.embeddingModel,
      chunks,
    };
    await writeFile(this.indexPath, JSON.stringify(payload), "utf8");
  }

  search(queryVector: number[], topK: number): VectorSearchHit[] {
    if (this.chunks.length === 0) return [];
    const indexDim = this.chunks[0]!.embedding.length;
    if (queryVector.length !== indexDim) {
      throw new Error(
        `Query embedding dimension (${queryVector.length}) does not match the index (${indexDim}). Re-ingest after changing embedding backend or model (index embeddingModel: ${this.embeddingModel}).`
      );
    }
    const scored: VectorSearchHit[] = this.chunks.map((c) => ({
      chunk: c,
      score: cosineSimilarity(queryVector, c.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  getChunkCount(): number {
    return this.chunks.length;
  }

  listSourceFiles(): string[] {
    const set = new Set(this.chunks.map((c) => c.metadata.filePath));
    return [...set].sort();
  }
}
