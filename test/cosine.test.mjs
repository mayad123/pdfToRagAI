/**
 * Unit tests for cosineSimilarity (N5 — stable retrieval contracts).
 * Run after: npm run build
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity } from "../dist/utils/cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  });

  it("returns -1 for opposite vectors", () => {
    const result = cosineSimilarity([1, 0], [-1, 0]);
    assert.ok(Math.abs(result - -1) < 1e-10, `expected -1, got ${result}`);
  });

  it("returns 0 for orthogonal vectors", () => {
    const result = cosineSimilarity([1, 0], [0, 1]);
    assert.ok(Math.abs(result) < 1e-10, `expected 0, got ${result}`);
  });

  it("returns 0 for mismatched lengths", () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  it("returns 0 for empty vectors", () => {
    assert.equal(cosineSimilarity([], []), 0);
  });

  it("returns 0 for zero vector", () => {
    assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
  });

  it("is symmetric", () => {
    const a = [0.1, 0.9, 0.5];
    const b = [0.8, 0.2, 0.6];
    const ab = cosineSimilarity(a, b);
    const ba = cosineSimilarity(b, a);
    assert.ok(Math.abs(ab - ba) < 1e-10, `expected symmetry, got ${ab} vs ${ba}`);
  });

  it("handles L2-normalized vectors (dot product = cosine)", () => {
    // L2-normalized: similarity should equal the dot product
    const mag = Math.sqrt(3);
    const a = [1 / mag, 1 / mag, 1 / mag];
    const result = cosineSimilarity(a, a);
    assert.ok(Math.abs(result - 1) < 1e-10, `expected 1 for unit vector self-similarity, got ${result}`);
  });
});
