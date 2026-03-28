import type { PdfToRagConfig } from "../config/defaults.js";
import { defaultConfig } from "../config/index.js";
import { createNoOpHooks } from "../hooks/index.js";
import { createAppDeps, runIngest } from "../application/index.js";

export interface IngestCliOptions {
  storeDir?: string;
  chunkSize?: string;
  overlap?: string;
  recursive?: boolean;
}

export async function ingestCommand(dir: string, options: IngestCliOptions): Promise<void> {
  const cwd = process.cwd();
  const overrides: Partial<PdfToRagConfig> = {};
  if (options.storeDir) overrides.storeDir = options.storeDir;
  if (options.chunkSize !== undefined) overrides.chunkSize = Number(options.chunkSize);
  if (options.overlap !== undefined) overrides.chunkOverlap = Number(options.overlap);
  if (options.recursive === false) overrides.recursive = false;

  const config = defaultConfig(overrides);
  const deps = await createAppDeps(cwd, config);
  const hooks = createNoOpHooks();

  const result = await runIngest(dir, cwd, deps, hooks);

  console.log(
    `Indexed ${result.chunksIndexed} chunks from ${result.filesProcessed} files (${result.pagesProcessed} pages).`
  );
  console.log(`Store: ${result.storePath}`);
}
