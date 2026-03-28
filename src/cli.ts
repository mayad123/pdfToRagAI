#!/usr/bin/env node
import { Command } from "commander";
import { ingestCommand } from "./commands/ingest.js";
import { queryCommand } from "./commands/query.js";
import { inspectCommand } from "./commands/inspect.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("pdf-to-rag")
  .description("Ingest PDFs into a local embedding index and query with citations")
  .version(readVersion());

program
  .command("ingest")
  .description("Index all PDFs under a directory (full reindex)")
  .argument("<dir>", "folder containing PDFs")
  .option("--store-dir <path>", "directory for the index", ".pdf-to-rag")
  .option("--chunk-size <n>", "max chunk length in characters")
  .option("--overlap <n>", "chunk overlap in characters")
  .option("--no-recursive", "only scan the top-level directory")
  .action(
    async (
      dir: string,
      opts: { storeDir: string; chunkSize?: string; overlap?: string; noRecursive?: boolean }
    ) => {
      await ingestCommand(dir, {
        storeDir: opts.storeDir,
        chunkSize: opts.chunkSize,
        overlap: opts.overlap,
        recursive: opts.noRecursive ? false : true,
      });
    }
  );

program
  .command("query")
  .description("Semantic search: natural-language question or phrase (match count + topK printed first)")
  .argument("<words...>", "natural language question or phrase")
  .option("--store-dir <path>", "directory for the index", ".pdf-to-rag")
  .option("--top-k <n>", "number of chunks to return")
  .action(async (words: string[], opts: { storeDir: string; topK?: string }) => {
    await queryCommand(words.join(" "), { storeDir: opts.storeDir, topK: opts.topK });
  });

program
  .command("inspect")
  .description("Show index stats")
  .option("--store-dir <path>", "directory for the index", ".pdf-to-rag")
  .action(async (opts: { storeDir: string }) => {
    await inspectCommand({ storeDir: opts.storeDir });
  });

await program.parseAsync(process.argv);
