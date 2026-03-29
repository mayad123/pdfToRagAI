import { stat } from "node:fs/promises";
import type { Chunk } from "../domain/chunk.js";
import type { DocumentRef } from "../domain/document.js";
import type { PdfToRagConfig } from "../config/defaults.js";
import type { Embedder } from "../embeddings.js";
import type { IndexedChunk, VectorStore, SourceFileFingerprint } from "../storage/types.js";
import { extractPages } from "../pdf/extract.js";
import { cleanPageText } from "../normalization/clean.js";
import { chunkDocumentText } from "../chunking/document.js";

export interface IngestPipelineResult {
  chunks: Chunk[];
  indexed: number;
  pagesProcessed: number;
  filesSkipped: number;
}

/**
 * files → pages → cleaned text → cross-page chunks → embeddings → incremental storage.
 *
 * Features active per config:
 *  - F10: parallel page extraction (in extractPages)
 *  - F11: "passage" role passed to embedder (asymmetric prefixes via env vars)
 *  - F12: [Document: X | Page N] context prefix on embed inputs (not stored text)
 *  - F13: mtime+size fingerprints; unchanged files are skipped
 *  - Page boundary buffer: entire document chunked as one text (chunkDocumentText)
 */
export async function runIngestPipeline(
  docs: DocumentRef[],
  config: PdfToRagConfig,
  embedder: Embedder,
  store: VectorStore
): Promise<IngestPipelineResult> {
  await store.load();
  const existingFingerprints = store.getSourceFileFingerprints();

  const allChunks: Chunk[] = [];
  let pagesProcessed = 0;
  let filesSkipped = 0;

  const changedRelPaths: string[] = [];
  const newFingerprints: Record<string, SourceFileFingerprint> = {};

  for (const doc of docs) {
    const fileStat = await stat(doc.absolutePath);
    const fp: SourceFileFingerprint = { mtime: fileStat.mtimeMs, size: fileStat.size };
    const existing = existingFingerprints[doc.relativePath];
    if (existing && existing.mtime === fp.mtime && existing.size === fp.size) {
      filesSkipped++;
      continue;
    }

    changedRelPaths.push(doc.relativePath);
    newFingerprints[doc.relativePath] = fp;

    const pageList = await extractPages(doc.absolutePath, { stripMargins: config.stripMargins });
    pagesProcessed += pageList.length;

    const cleanedPages = pageList.map((p) => ({
      pageNumber: p.pageNumber,
      text: cleanPageText(p.text),
    }));

    const docChunks = chunkDocumentText(cleanedPages, doc, {
      chunkSize: config.chunkSize,
      overlap: config.chunkOverlap,
    });
    allChunks.push(...docChunks);
  }

  if (changedRelPaths.length === 0) {
    return { chunks: [], indexed: 0, pagesProcessed: 0, filesSkipped };
  }

  // Build embed inputs: optionally prepend context prefix for richer passage representations (F12).
  const embedInputs = allChunks.map((c) =>
    config.contextPrefix
      ? `[Document: ${c.metadata.fileName} | Page ${c.metadata.page}] ${c.text}`
      : c.text
  );

  // Pass "passage" role so env-var prefixes apply asymmetrically (F11).
  const embeddings = await embedder.embed(embedInputs, "passage");

  const newIndexedChunks: IndexedChunk[] = allChunks.map((c, i) => ({
    id: c.metadata.id,
    text: c.text,
    embedding: embeddings[i]!,
    metadata: c.metadata,
  }));

  await store.replaceForFiles(changedRelPaths, newIndexedChunks, newFingerprints);

  return {
    chunks: allChunks,
    indexed: newIndexedChunks.length,
    pagesProcessed,
    filesSkipped,
  };
}
