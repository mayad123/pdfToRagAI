import { join, resolve } from "node:path";
import type { PdfToRagConfig } from "../config/defaults.js";
import type { InspectResult } from "../domain/results.js";
import { FileVectorStore } from "../storage/file-store.js";

/** Loads only the on-disk index (no embedding model). */
export async function runInspect(cwd: string, config: PdfToRagConfig): Promise<InspectResult> {
  const storePath = join(resolve(cwd), config.storeDir, config.indexFileName);
  const store = new FileVectorStore(storePath, config.embeddingModel);
  await store.load();
  return {
    storePath,
    chunkCount: store.getChunkCount(),
    files: store.listSourceFiles(),
  };
}
