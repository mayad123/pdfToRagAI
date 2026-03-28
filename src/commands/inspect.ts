import type { PdfToRagConfig } from "../config/defaults.js";
import { defaultConfig } from "../config/index.js";
import { runInspect } from "../application/inspect.js";

export interface InspectCliOptions {
  storeDir?: string;
}

export async function inspectCommand(options: InspectCliOptions): Promise<void> {
  const cwd = process.cwd();
  const overrides: Partial<PdfToRagConfig> = {};
  if (options.storeDir) overrides.storeDir = options.storeDir;

  const config = defaultConfig(overrides);
  const result = await runInspect(cwd, config);

  console.log(`Store: ${result.storePath}`);
  console.log(`Chunks: ${result.chunkCount}`);
  console.log("Files:");
  for (const f of result.files) {
    console.log(`  - ${f}`);
  }
}
