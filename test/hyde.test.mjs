/**
 * Unit tests for HyDE (hypotheticalAnswer) in searchQuery (F15).
 * Verifies that when hypotheticalAnswer is provided it is embedded with "passage" role
 * instead of the question, and that the standard query path is unchanged.
 * Run after: npm run build
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchQuery } from "../dist/query/search.js";
import { FileVectorStore } from "../dist/storage/file-store.js";

function makeChunk(id, text, embedding) {
  return {
    id,
    text,
    embedding,
    metadata: { id, fileName: "doc.pdf", filePath: "doc.pdf", page: 1, chunkIndex: 0 },
  };
}

/** Minimal config for searchQuery calls. */
const baseConfig = {
  topK: 5,
  mmr: false,
  mmrLambda: 0.5,
  chunkSize: 512,
  chunkOverlap: 64,
  storeDir: ".pdf-to-rag",
  indexFileName: "index.json",
  embeddingModel: "test",
  recursive: true,
  stripMargins: true,
  contextPrefix: false,
};

describe("searchQuery — HyDE (F15)", () => {
  let tmpDir;
  let store;

  // Track which role was used and what text was embedded.
  let lastEmbedText;
  let lastEmbedRole;

  /** Stub embedder that records calls and returns a fixed vector based on the input text. */
  const stubEmbedder = {
    async embedOne(text, role) {
      lastEmbedText = text;
      lastEmbedRole = role;
      // Return a deterministic 3-dim vector based on whether it's a query or passage.
      return role === "passage" ? [0, 0, 1] : [1, 0, 0];
    },
    async embedBatch(texts, role) {
      return texts.map(() => (role === "passage" ? [0, 0, 1] : [1, 0, 0]));
    },
  };

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-hyde-test-"));
    store = new FileVectorStore(join(tmpDir, "index.json"), "test");
    await store.replaceAll([makeChunk("c1", "chunk one", [1, 0, 0])]);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("standard path: embeds question with query role", async () => {
    await searchQuery("what is this?", baseConfig, stubEmbedder, store);
    assert.equal(lastEmbedRole, "query");
    assert.equal(lastEmbedText, "what is this?");
  });

  it("HyDE path: embeds hypotheticalAnswer with passage role", async () => {
    await searchQuery("what is this?", baseConfig, stubEmbedder, store, undefined, "This is a passage about topic X.");
    assert.equal(lastEmbedRole, "passage");
    assert.equal(lastEmbedText, "This is a passage about topic X.");
  });

  it("HyDE path: trims the hypotheticalAnswer before embedding", async () => {
    await searchQuery("q", baseConfig, stubEmbedder, store, undefined, "  trimmed answer  ");
    assert.equal(lastEmbedText, "trimmed answer");
    assert.equal(lastEmbedRole, "passage");
  });

  it("falls back to question when hypotheticalAnswer is empty string", async () => {
    await searchQuery("empty hyde", baseConfig, stubEmbedder, store, undefined, "");
    assert.equal(lastEmbedRole, "query");
    assert.equal(lastEmbedText, "empty hyde");
  });

  it("falls back to question when hypotheticalAnswer is whitespace only", async () => {
    await searchQuery("whitespace hyde", baseConfig, stubEmbedder, store, undefined, "   ");
    assert.equal(lastEmbedRole, "query");
  });
});
