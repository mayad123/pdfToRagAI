import { join, resolve } from "node:path";
import type { IngestResult } from "../domain/results.js";
import type { Hooks } from "../hooks/types.js";
import { listPdfFiles } from "../pdf/list.js";
import { runIngestPipeline } from "../ingestion/pipeline.js";
import type { AppDeps } from "./deps.js";

export async function runIngest(
  rootPath: string,
  cwd: string,
  deps: AppDeps,
  hooks: Hooks
): Promise<IngestResult> {
  const resolvedRoot = resolve(rootPath);
  const docs = await listPdfFiles(resolvedRoot, deps.config.recursive);

  await hooks.beforeIngest({
    rootPath: resolvedRoot,
    filePaths: docs.map((d) => d.absolutePath),
  });

  const { chunks, indexed, pagesProcessed, filesSkipped } = await runIngestPipeline(
    docs,
    deps.config,
    deps.embedder,
    deps.store
  );

  await hooks.afterChunking({ chunks });
  await hooks.afterIndexing({ count: indexed });

  const storePath = join(resolve(cwd), deps.config.storeDir, deps.config.indexFileName);

  return {
    filesProcessed: docs.length - filesSkipped,
    filesSkipped,
    pagesProcessed,
    chunksIndexed: indexed,
    storePath,
  };
}
