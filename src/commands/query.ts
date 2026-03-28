import type { PdfToRagConfig } from "../config/defaults.js";
import { defaultConfig } from "../config/index.js";
import { createNoOpHooks } from "../hooks/index.js";
import { createAppDeps, runQuery } from "../application/index.js";

export interface QueryCliOptions {
  storeDir?: string;
  topK?: string;
}

export async function queryCommand(question: string, options: QueryCliOptions): Promise<void> {
  const cwd = process.cwd();
  const overrides: Partial<PdfToRagConfig> = {};
  if (options.storeDir) overrides.storeDir = options.storeDir;
  if (options.topK !== undefined) overrides.topK = Number(options.topK);

  const config = defaultConfig(overrides);
  const deps = await createAppDeps(cwd, config);
  const hooks = createNoOpHooks();

  const hits = await runQuery(question, deps, hooks);
  const topK = config.topK;

  if (hits.length === 0) {
    console.log(`No passages returned (topK=${topK}). Empty index or no semantic matches.`);
    return;
  }

  const n = hits.length;
  const passageWord = n === 1 ? "passage" : "passages";
  console.log(`Returned ${n} ${passageWord} (topK=${topK}).`);

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    console.log("");
    console.log(`--- #${i + 1} ${h.fileName} (page ${h.page}) score=${h.score.toFixed(4)} ---`);
    console.log(h.text);
  }
}
