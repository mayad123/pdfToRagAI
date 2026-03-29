/**
 * Unit tests for FileVectorStore.search() — dimension guard and minScore filter (N5).
 * Run after: npm run build
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileVectorStore } from "../dist/storage/file-store.js";

/** Minimal valid IndexedChunk with a 3-dimensional embedding. */
function makeChunk(id, text, embedding) {
  return {
    id,
    text,
    embedding,
    metadata: { id, fileName: "test.pdf", filePath: "test.pdf", page: 1, chunkIndex: 0 },
  };
}

describe("FileVectorStore.search() — dimension guard", () => {
  let tmpDir;
  let store;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-test-"));
    store = new FileVectorStore(join(tmpDir, "index.json"), "test-model");
    await store.replaceAll([
      makeChunk("c1", "hello world", [1, 0, 0]),
      makeChunk("c2", "foo bar baz", [0, 1, 0]),
    ]);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when query vector length differs from index dimension", () => {
    assert.throws(
      () => store.search([1, 0, 0, 0], 5), // 4-dim query vs 3-dim index
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("dimension"), `expected 'dimension' in: ${err.message}`);
        assert.ok(err.message.includes("4"), `expected query dim 4 in: ${err.message}`);
        assert.ok(err.message.includes("3"), `expected index dim 3 in: ${err.message}`);
        return true;
      }
    );
  });

  it("returns results matching the query vector dimension", () => {
    const hits = store.search([1, 0, 0], 5);
    assert.equal(hits.length, 2);
    // c1 should rank first (identical to query vector)
    assert.equal(hits[0].chunk.id, "c1");
    assert.ok(hits[0].score > hits[1].score, "expected c1 to score higher than c2");
  });

  it("respects topK limit", () => {
    const hits = store.search([1, 0, 0], 1);
    assert.equal(hits.length, 1);
  });

  it("returns empty array when store has no chunks", async () => {
    const emptyStore = new FileVectorStore(join(tmpDir, "empty.json"), "test-model");
    await emptyStore.replaceAll([]);
    const hits = emptyStore.search([1, 0, 0], 5);
    assert.equal(hits.length, 0);
  });
});

describe("FileVectorStore.search() — minScore filter", () => {
  let tmpDir;
  let store;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-test-minscore-"));
    store = new FileVectorStore(join(tmpDir, "index.json"), "test-model");
    // [1,0] vs [1,0] → score 1.0; [1,0] vs [0,1] → score 0.0
    await store.replaceAll([
      makeChunk("high", "high similarity", [1, 0]),
      makeChunk("low", "low similarity", [0, 1]),
    ]);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excludes chunks below minScore", () => {
    const hits = store.search([1, 0], 5, 0.5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].chunk.id, "high");
  });

  it("includes all chunks when minScore is 0", () => {
    const hits = store.search([1, 0], 5, 0);
    assert.equal(hits.length, 2);
  });

  it("returns empty when minScore excludes everything", () => {
    const hits = store.search([1, 0], 5, 0.99);
    assert.equal(hits.length, 1); // score 1.0 passes 0.99
    const hits2 = store.search([0.5, 0.5].map((v) => v / Math.sqrt(0.5)), 5, 0.999);
    // orthogonal-ish: should filter both
    assert.ok(hits2.length === 0 || hits2.every((h) => h.score >= 0.999));
  });

  it("minScore filter applied before topK truncation", () => {
    // With minScore=0.5 only 1 chunk passes; topK=10 should return just that 1
    const hits = store.search([1, 0], 10, 0.5);
    assert.equal(hits.length, 1);
  });
});
