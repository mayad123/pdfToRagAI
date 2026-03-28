import { createHash } from "node:crypto";

/**
 * Deterministic chunk id from path, page, and chunk index.
 * SHA-256 hex, truncated for stable compact ids.
 */
export function deterministicChunkId(
  relativePath: string,
  page: number,
  chunkIndex: number,
  length = 32
): string {
  const h = createHash("sha256");
  h.update(relativePath, "utf8");
  h.update("\0");
  h.update(String(page), "utf8");
  h.update("\0");
  h.update(String(chunkIndex), "utf8");
  return h.digest("hex").slice(0, length);
}
