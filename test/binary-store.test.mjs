/**
 * Unit tests for FileVectorStore v3 binary sidecar (N7).
 * Verifies that embeddings round-trip through the binary format and
 * that v2 indexes load correctly and upgrade to v3 on next write.
 * Run after: npm run build
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

describe("FileVectorStore — v3 binary sidecar", () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-binary-test-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes index.json (v3) and index.bin sidecar on save", async () => {
    const store = new FileVectorStore(join(tmpDir, "v3-write", "index.json"), "test-model");
    await store.replaceAll([makeChunk("c1", "hello", [1, 2, 3])]);

    const jsonPath = join(tmpDir, "v3-write", "index.json");
    const binPath = join(tmpDir, "v3-write", "index.bin");
    assert.ok(existsSync(jsonPath), "index.json should exist");
    assert.ok(existsSync(binPath), "index.bin sidecar should exist");

    const json = JSON.parse(readFileSync(jsonPath, "utf8"));
    assert.equal(json.version, 3, "index.json should be version 3");
    assert.equal(json.embeddingDim, 3, "embeddingDim should match embedding length");
    assert.deepEqual(json.chunks[0].embedding, [], "embeddings stripped from JSON");
  });

  it("binary file contains correct Float32Array data", async () => {
    const store = new FileVectorStore(join(tmpDir, "v3-floats", "index.json"), "test-model");
    const vec = [0.1, 0.5, 0.9];
    await store.replaceAll([makeChunk("c1", "vec test", vec)]);

    const binPath = join(tmpDir, "v3-floats", "index.bin");
    const buf = readFileSync(binPath);
    const floats = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.equal(floats.length, 3);
    // Float32 precision: compare with tolerance
    for (let i = 0; i < vec.length; i++) {
      assert.ok(Math.abs(floats[i] - vec[i]) < 1e-6, `floats[${i}] mismatch: ${floats[i]} vs ${vec[i]}`);
    }
  });

  it("loads v3 index and restores embeddings from sidecar", async () => {
    const indexPath = join(tmpDir, "v3-roundtrip", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    const chunks = [
      makeChunk("a", "chunk a", [1, 0, 0]),
      makeChunk("b", "chunk b", [0, 1, 0]),
    ];
    await store.replaceAll(chunks);

    // Load in a fresh store instance
    const store2 = new FileVectorStore(indexPath, "test-model");
    await store2.load();

    const hits = store2.search([1, 0, 0], 2);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].chunk.id, "a", "chunk a should have highest cosine similarity to [1,0,0]");
    // Verify embedding was restored
    assert.equal(hits[0].chunk.embedding.length, 3);
    assert.ok(Math.abs(hits[0].chunk.embedding[0] - 1) < 1e-6);
  });

  it("multiple chunks preserve order and individual vectors", async () => {
    const indexPath = join(tmpDir, "v3-multi", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    const chunks = [
      makeChunk("x", "x", [1, 0, 0, 0]),
      makeChunk("y", "y", [0, 1, 0, 0]),
      makeChunk("z", "z", [0, 0, 1, 0]),
    ];
    await store.replaceAll(chunks);

    const store2 = new FileVectorStore(indexPath, "test-model");
    await store2.load();

    // Search for each canonical basis vector — the matching chunk should be first
    for (const { id, vec } of [
      { id: "x", vec: [1, 0, 0, 0] },
      { id: "y", vec: [0, 1, 0, 0] },
      { id: "z", vec: [0, 0, 1, 0] },
    ]) {
      const hits = store2.search(vec, 1);
      assert.equal(hits[0].chunk.id, id, `expected ${id} to be top hit for its own vector`);
    }
  });

  it("empty store writes zero-byte sidecar and loads back cleanly", async () => {
    const indexPath = join(tmpDir, "v3-empty", "index.json");
    const store = new FileVectorStore(indexPath, "test-model");
    await store.replaceAll([]);

    const store2 = new FileVectorStore(indexPath, "test-model");
    await store2.load();
    assert.equal(store2.getChunkCount(), 0);
    assert.deepEqual(store2.search([1, 0, 0], 5), []);
  });

  it("v2 index loads correctly (backward-compatible) and upgrades to v3 on save", async () => {
    const indexPath = join(tmpDir, "v2-upgrade", "index.json");
    // Write a v2-format file by hand
    const v2Payload = {
      version: 2,
      embeddingModel: "test-model",
      sourceFiles: {},
      chunks: [{ id: "v2c", text: "v2 chunk", embedding: [1, 2, 3], metadata: { id: "v2c", fileName: "f.pdf", filePath: "f.pdf", page: 1, chunkIndex: 0 } }],
    };
    const dir = join(tmpDir, "v2-upgrade");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    writeFileSync(indexPath, JSON.stringify(v2Payload));

    const store = new FileVectorStore(indexPath, "test-model");
    await store.load();
    assert.equal(store.getChunkCount(), 1);

    // Search should work with v2 embeddings in memory
    const hits = store.search([1, 2, 3], 1);
    assert.equal(hits[0].chunk.id, "v2c");

    // Trigger a save (simulating incremental ingest touching this store)
    await store.replaceAll(store.search([1, 0, 0], 10).map((h) => h.chunk));

    // After save, should be v3
    const json = JSON.parse(readFileSync(indexPath, "utf8"));
    assert.equal(json.version, 3, "store should upgrade to v3 on next write");
    assert.ok(existsSync(indexPath.replace(".json", ".bin")), "sidecar should be written after v2→v3 upgrade");
  });
});
