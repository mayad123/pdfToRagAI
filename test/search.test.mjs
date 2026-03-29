/**
 * Unit tests for normalizeQueryText and mmrSelect (N5 — stable retrieval contracts).
 * Run after: npm run build
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeQueryText } from "../dist/query/search.js";
import { mmrSelect } from "../dist/query/mmr.js";

describe("normalizeQueryText", () => {
  it("trims leading and trailing whitespace", () => {
    assert.equal(normalizeQueryText("  hello world  "), "hello world");
  });

  it("collapses internal whitespace to single spaces", () => {
    assert.equal(normalizeQueryText("what  is   this"), "what is this");
  });

  it("collapses tabs and newlines", () => {
    assert.equal(normalizeQueryText("what\tis\nthis"), "what is this");
  });

  it("returns empty string for whitespace-only input", () => {
    assert.equal(normalizeQueryText("   \t\n  "), "");
  });

  it("returns the string unchanged when already normalized", () => {
    assert.equal(normalizeQueryText("what is the brain?"), "what is the brain?");
  });
});

describe("mmrSelect", () => {
  /** Make a minimal VectorSearchHit for testing. */
  function hit(id, score, embedding) {
    return {
      chunk: {
        id,
        text: id,
        embedding,
        metadata: { id, fileName: "f.pdf", filePath: "f.pdf", page: 1, chunkIndex: 0 },
      },
      score,
    };
  }

  it("returns empty array for empty candidates", () => {
    assert.deepEqual(mmrSelect([], [1, 0], 5, 0.5), []);
  });

  it("returns at most k results", () => {
    const candidates = [
      hit("a", 0.9, [1, 0]),
      hit("b", 0.8, [0.9, 0.1]),
      hit("c", 0.7, [0.8, 0.2]),
    ];
    const results = mmrSelect(candidates, [1, 0], 2, 0.5);
    assert.equal(results.length, 2);
  });

  it("with lambda=1 (pure relevance) preserves score order", () => {
    const candidates = [
      hit("a", 0.9, [1, 0]),
      hit("b", 0.8, [0, 1]),
      hit("c", 0.7, [0.5, 0.5]),
    ];
    const results = mmrSelect(candidates, [1, 0], 3, 1);
    assert.equal(results[0].chunk.id, "a");
    assert.equal(results[1].chunk.id, "b");
    assert.equal(results[2].chunk.id, "c");
  });

  it("with lambda=0 (pure diversity) avoids redundant selections", () => {
    // a and b are nearly identical; c is orthogonal
    const candidates = [
      hit("a", 0.9, [1, 0]),      // most relevant
      hit("b", 0.85, [0.99, 0.1]), // nearly identical to a
      hit("c", 0.5, [0, 1]),      // orthogonal (diverse)
    ];
    // lambda=0: after selecting 'a', diversity favors 'c' over near-duplicate 'b'
    const results = mmrSelect(candidates, [1, 0], 2, 0);
    assert.equal(results[0].chunk.id, "a");
    assert.equal(results[1].chunk.id, "c", "expected diverse pick over near-duplicate");
  });

  it("returns all candidates when k >= candidates.length", () => {
    const candidates = [hit("a", 0.9, [1, 0]), hit("b", 0.5, [0, 1])];
    const results = mmrSelect(candidates, [1, 0], 10, 0.5);
    assert.equal(results.length, 2);
  });
});
