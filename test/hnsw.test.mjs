/**
 * Unit tests for HNSW approximate nearest-neighbor search (N7).
 * Forces HNSW to activate by setting PDF_TO_RAG_HNSW_THRESHOLD to a low value,
 * then verifies that search results match the linear baseline.
 * Run after: npm run build
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileVectorStore } from "../dist/storage/file-store.js";

function makeChunk(id, text, embedding) {
  return {
    id,
    text,
    embedding,
    metadata: { id, fileName: "doc.pdf", filePath: "doc.pdf", page: 1, chunkIndex: 0 },
  };
}

// Force HNSW to activate for small indexes in tests.
const originalThreshold = process.env.PDF_TO_RAG_HNSW_THRESHOLD;
process.env.PDF_TO_RAG_HNSW_THRESHOLD = "3";

describe("FileVectorStore — HNSW (N7)", () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-hnsw-test-"));
  });

  after(() => {
    if (originalThreshold !== undefined) {
      process.env.PDF_TO_RAG_HNSW_THRESHOLD = originalThreshold;
    } else {
      delete process.env.PDF_TO_RAG_HNSW_THRESHOLD;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes index.hnsw sidecar when chunk count meets threshold", async () => {
    const indexPath = join(tmpDir, "hnsw-write", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    // 3 chunks — meets the threshold=3 we set above
    await store.replaceAll([
      makeChunk("a", "a", [1, 0, 0]),
      makeChunk("b", "b", [0, 1, 0]),
      makeChunk("c", "c", [0, 0, 1]),
    ]);
    assert.ok(existsSync(indexPath.replace(".json", ".hnsw")), "index.hnsw should be written");
  });

  it("does not write index.hnsw when chunk count is below threshold", async () => {
    const indexPath = join(tmpDir, "hnsw-skip", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    // 2 chunks — below threshold=3
    await store.replaceAll([
      makeChunk("a", "a", [1, 0, 0]),
      makeChunk("b", "b", [0, 1, 0]),
    ]);
    assert.ok(!existsSync(indexPath.replace(".json", ".hnsw")), "index.hnsw should NOT be written below threshold");
  });

  it("HNSW search returns correct top hit (matches linear search)", async () => {
    const indexPath = join(tmpDir, "hnsw-search", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    await store.replaceAll([
      makeChunk("a", "a", [1, 0, 0]),
      makeChunk("b", "b", [0, 1, 0]),
      makeChunk("c", "c", [0, 0, 1]),
    ]);

    // Load fresh to use HNSW
    const store2 = new FileVectorStore(indexPath, "test-model");
    await store2.load();

    const hits = store2.search([1, 0, 0], 3);
    assert.equal(hits.length, 3);
    assert.equal(hits[0].chunk.id, "a", "chunk 'a' should be the top hit for [1,0,0]");
    // Cosine similarity of [1,0,0] vs [1,0,0] ≈ 1
    assert.ok(hits[0].score > 0.99, `expected high score for exact match, got ${hits[0].score}`);
  });

  it("HNSW search respects topK limit", async () => {
    const indexPath = join(tmpDir, "hnsw-topk", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    await store.replaceAll([
      makeChunk("a", "a", [1, 0, 0]),
      makeChunk("b", "b", [0, 1, 0]),
      makeChunk("c", "c", [0, 0, 1]),
    ]);

    const store2 = new FileVectorStore(indexPath, "test-model");
    await store2.load();

    const hits = store2.search([1, 0, 0], 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].chunk.id, "a");
  });

  it("HNSW scores are cosine similarities (between -1 and 1)", async () => {
    const indexPath = join(tmpDir, "hnsw-scores", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    await store.replaceAll([
      makeChunk("a", "a", [1, 0, 0]),
      makeChunk("b", "b", [0, 1, 0]),
      makeChunk("c", "c", [0, 0, 1]),
    ]);

    const store2 = new FileVectorStore(indexPath, "test-model");
    await store2.load();

    const hits = store2.search([1, 0, 0], 3);
    for (const hit of hits) {
      assert.ok(hit.score >= -1 && hit.score <= 1, `score ${hit.score} out of [-1,1] range`);
    }
  });

  it("dimension guard still fires when HNSW is active", async () => {
    const indexPath = join(tmpDir, "hnsw-dim-guard", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    await store.replaceAll([
      makeChunk("a", "a", [1, 0, 0]),
      makeChunk("b", "b", [0, 1, 0]),
      makeChunk("c", "c", [0, 0, 1]),
    ]);

    const store2 = new FileVectorStore(indexPath, "test-model");
    await store2.load();

    assert.throws(
      () => store2.search([1, 0, 0, 0], 3), // 4-dim vs 3-dim index
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("dimension"));
        return true;
      }
    );
  });
});
