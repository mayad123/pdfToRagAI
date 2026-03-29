import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { cosineSimilarity } from "../utils/cosine.js";

// hnswlib-node is a CJS native addon; use createRequire to load it in an ESM context.
const _require = createRequire(import.meta.url);

type HnswInstance = {
  initIndex(maxElements: number): void;
  addPoint(point: number[], label: number): void;
  searchKnn(query: number[], k: number): { distances: number[]; neighbors: number[] };
  readIndex(filename: string): Promise<boolean>;
  writeIndex(filename: string): Promise<boolean>;
  setEf(ef: number): void;
};

type HnswConstructor = new (spaceName: string, numDimensions: number) => HnswInstance;
const { HierarchicalNSW } = _require("hnswlib-node") as { HierarchicalNSW: HnswConstructor };
import type { IndexedChunk, VectorSearchHit, VectorStore, SourceFileFingerprint } from "./types.js";

interface IndexFileV1 {
  version: 1;
  embeddingModel: string;
  chunks: IndexedChunk[];
}

interface IndexFileV2 {
  version: 2;
  embeddingModel: string;
  sourceFiles: Record<string, SourceFileFingerprint>;
  chunks: IndexedChunk[];
}

/**
 * Schema v3 (N7 binary sidecar): embeddings are stored in `<basename>.bin` as a raw Float32Array
 * rather than inline in the JSON. The `embeddingDim` field records the vector dimension so the
 * binary blob can be read without parsing individual chunk arrays.
 * When chunk count ≥ PDF_TO_RAG_HNSW_THRESHOLD, an HNSW index (`<basename>.hnsw`) is also kept
 * for approximate nearest-neighbor search.
 * `chunks` in the JSON have `embedding: []` (stripped); populated from the sidecar on load.
 */
interface IndexFileV3 {
  version: 3;
  embeddingModel: string;
  embeddingDim: number;
  sourceFiles: Record<string, SourceFileFingerprint>;
  chunks: Array<Omit<IndexedChunk, "embedding"> & { embedding: [] }>;
}

/** Number of chunks above which HNSW is built and used for ANN search (N7). Read at call time so the env var can be set before first use. */
function hnswThreshold(): number {
  return parseInt(process.env.PDF_TO_RAG_HNSW_THRESHOLD ?? "2000", 10);
}

function binPath(p: string): string {
  return p.endsWith(".json") ? p.slice(0, -5) + ".bin" : p + ".bin";
}

function hnswPath(p: string): string {
  return p.endsWith(".json") ? p.slice(0, -5) + ".hnsw" : p + ".hnsw";
}

export class FileVectorStore implements VectorStore {
  private chunks: IndexedChunk[] = [];
  private _fingerprints: Record<string, SourceFileFingerprint> = {};
  private _loaded = false;
  private _hnsw: HnswInstance | null = null;

  constructor(
    private readonly indexPath: string,
    public readonly embeddingModel: string
  ) {}

  async load(): Promise<void> {
    if (this._loaded) return;
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as IndexFileV1 | IndexFileV2 | IndexFileV3;

      if (parsed.version === 3) {
        const v3 = parsed as IndexFileV3;
        this._fingerprints = v3.sourceFiles ?? {};
        const dim = v3.embeddingDim;

        if (dim > 0 && v3.chunks.length > 0) {
          const binBuf = await readFile(binPath(this.indexPath));
          const floats = new Float32Array(
            binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength)
          );
          this.chunks = v3.chunks.map((c, i) => ({
            ...c,
            embedding: Array.from(floats.subarray(i * dim, (i + 1) * dim)),
          }));
        } else {
          this.chunks = v3.chunks.map((c) => ({ ...c, embedding: [] }));
        }

        // Load HNSW sidecar if present and chunk count meets threshold.
        if (this.chunks.length >= hnswThreshold() && dim > 0) {
          try {
            const hnsw = new HierarchicalNSW("cosine", dim);
            await hnsw.readIndex(hnswPath(this.indexPath));
            this._hnsw = hnsw;
          } catch {
            // HNSW file absent or corrupt — fall back to linear search silently.
            this._hnsw = null;
          }
        }
      } else if (parsed.version === 2) {
        this.chunks = parsed.chunks ?? [];
        this._fingerprints = (parsed as IndexFileV2).sourceFiles ?? {};
      } else if (parsed.version === 1) {
        // Migrate v1 → v2: no fingerprints, all files will be re-indexed on next incremental run.
        this.chunks = parsed.chunks ?? [];
        this._fingerprints = {};
      } else {
        throw new Error(`Unsupported index version: ${String((parsed as { version: unknown }).version)}`);
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        this.chunks = [];
        this._fingerprints = {};
      } else {
        throw e;
      }
    }
    this._loaded = true;
  }

  async replaceAll(chunks: IndexedChunk[]): Promise<void> {
    this.chunks = chunks;
    this._fingerprints = {};
    this._loaded = true;
    await this._save();
  }

  async replaceForFiles(
    relativePaths: string[],
    newChunks: IndexedChunk[],
    fingerprints: Record<string, SourceFileFingerprint>
  ): Promise<void> {
    const pathSet = new Set(relativePaths);
    const kept = this.chunks.filter((c) => !pathSet.has(c.metadata.filePath));
    this.chunks = [...kept, ...newChunks];
    for (const [path, fp] of Object.entries(fingerprints)) {
      this._fingerprints[path] = fp;
    }
    this._loaded = true;
    await this._save();
  }

  private async _save(): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });

    const dim = this.chunks.length > 0 ? this.chunks[0]!.embedding.length : 0;

    // Binary sidecar (N7): raw Float32Array, one vector per chunk in array order.
    const floats = new Float32Array(this.chunks.length * dim);
    for (let i = 0; i < this.chunks.length; i++) {
      floats.set(this.chunks[i]!.embedding, i * dim);
    }
    await writeFile(binPath(this.indexPath), Buffer.from(floats.buffer));

    // HNSW index (N7): build when chunk count meets threshold.
    this._hnsw = null;
    if (this.chunks.length >= hnswThreshold() && dim > 0) {
      const hnsw = new HierarchicalNSW("cosine", dim);
      hnsw.initIndex(this.chunks.length);
      for (let i = 0; i < this.chunks.length; i++) {
        hnsw.addPoint(this.chunks[i]!.embedding, i);
      }
      await hnsw.writeIndex(hnswPath(this.indexPath));
      this._hnsw = hnsw;
    }

    // JSON v3: chunks without inline embeddings; dim stored for binary read.
    const payload: IndexFileV3 = {
      version: 3,
      embeddingModel: this.embeddingModel,
      embeddingDim: dim,
      sourceFiles: this._fingerprints,
      chunks: this.chunks.map(({ id, text, metadata }) => ({ id, text, embedding: [], metadata })),
    };
    await writeFile(this.indexPath, JSON.stringify(payload), "utf8");
  }

  search(queryVector: number[], topK: number, minScore?: number): VectorSearchHit[] {
    if (this.chunks.length === 0) return [];
    const indexDim = this.chunks[0]!.embedding.length;
    if (queryVector.length !== indexDim) {
      throw new Error(
        `Query embedding dimension (${queryVector.length}) does not match the index (${indexDim}). Re-ingest after changing embedding backend or model (index embeddingModel: ${this.embeddingModel}).`
      );
    }

    if (this._hnsw) {
      return this._hnswSearch(queryVector, topK, minScore);
    }
    return this._linearSearch(queryVector, topK, minScore);
  }

  private _hnswSearch(queryVector: number[], topK: number, minScore?: number): VectorSearchHit[] {
    // Fetch a larger candidate pool to give minScore filtering room; HNSW ef also boosted.
    const ef = Math.max(topK * 3, 50);
    this._hnsw!.setEf(ef);
    const numCandidates = Math.min(Math.max(topK * 3, topK), this.chunks.length);
    const { distances, neighbors } = this._hnsw!.searchKnn(queryVector, numCandidates);

    // HNSW 'cosine' space: distance = 1 − cosine_similarity → score = 1 − distance.
    const hits: VectorSearchHit[] = neighbors.map((idx, i) => ({
      chunk: this.chunks[idx]!,
      score: 1 - distances[i]!,
    }));
    hits.sort((a, b) => b.score - a.score);
    const filtered = minScore !== undefined ? hits.filter((h) => h.score >= minScore) : hits;
    return filtered.slice(0, topK);
  }

  private _linearSearch(queryVector: number[], topK: number, minScore?: number): VectorSearchHit[] {
    const scored: VectorSearchHit[] = this.chunks.map((c) => ({
      chunk: c,
      score: cosineSimilarity(queryVector, c.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    const filtered = minScore !== undefined ? scored.filter((h) => h.score >= minScore) : scored;
    return filtered.slice(0, topK);
  }

  getChunkCount(): number {
    return this.chunks.length;
  }

  listSourceFiles(): string[] {
    const set = new Set(this.chunks.map((c) => c.metadata.filePath));
    return [...set].sort();
  }

  getSourceFileFingerprints(): Record<string, SourceFileFingerprint> {
    return this._fingerprints;
  }
}
