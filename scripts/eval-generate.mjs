#!/usr/bin/env node
/**
 * Synthetic Q&A dataset generator (F16).
 *
 * Reads the built vector index, samples chunks, and calls a local LLM
 * (Ollama /api/chat) to generate one specific question per chunk.
 * The resulting (chunkId → question) pairs form a gold dataset where
 * each question's definitive answer is the source chunk.
 *
 * This dataset is then consumed by `eval-run.mjs` (eval:run) to measure
 * retrieval quality — Hit@K, MRR, nDCG — without any manual annotation.
 *
 * Requires: Ollama running with a chat model pulled (e.g. `ollama pull llama3.2`).
 *
 * Usage:
 *   npm run build
 *   npm run eval:generate
 *   npm run eval:generate -- --sample 100 --concurrency 5 --output eval-dataset.json
 *   npm run eval:generate -- --resume                    # skip already-generated chunks
 *   npm run eval:generate -- --store-dir .pdf-to-rag-custom
 *
 * Env:
 *   OLLAMA_HOST         Ollama base URL   (default http://127.0.0.1:11434)
 *   OLLAMA_CHAT_MODEL   Chat model name   (default llama3.2)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Seeded RNG (xorshift32) for reproducible chunk sampling
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let s = ((seed >>> 0) || 0xdeadbeef) >>> 0;
  return function () {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function sampleSeeded(arr, n, seed) {
  if (n >= arr.length) return [...arr];
  const rng = makeRng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length).fill(null);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 1 }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

function progressLine(done, total, label) {
  const pct = Math.floor((done / total) * 100);
  const filled = Math.floor(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const lbl = (label ?? "").slice(0, 35).padEnd(35);
  process.stdout.write(`\r  [${bar}] ${String(done).padStart(4)}/${total}  ${lbl}`);
}

// ---------------------------------------------------------------------------
// Ollama question generation
// ---------------------------------------------------------------------------

const GENERATION_PROMPT = (text) =>
  [
    "Generate exactly one specific question whose complete answer is contained in the following passage.",
    "",
    "Requirements:",
    "- The question must be specific enough that only this passage would answer it",
    "- Sound like a natural question a student or researcher might ask",
    "- Do not reference \"the passage\" or \"the text\" — ask the question directly",
    "- Return only the question, on a single line, with no preamble or explanation",
    "",
    "Passage:",
    text,
  ].join("\n");

async function generateQuestion(ollamaBase, model, text) {
  const res = await fetch(`${ollamaBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: GENERATION_PROMPT(text) }],
      stream: false,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama /api/chat ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = (data.message?.content ?? data.response ?? "").trim();
  // Strip surrounding quotation marks models sometimes add
  return raw.replace(/^["']|["']$/g, "").trim();
}

function isValidQuestion(q) {
  if (!q || q.length < 10 || q.length > 500) return false;
  // Must contain a question word or end with ?
  return /[?]/.test(q) || /\b(what|where|when|who|which|how|why|describe|explain|define)\b/i.test(q);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    storeDir: ".pdf-to-rag",
    indexFile: "index.json",
    output: "eval-dataset.json",
    sample: null,       // null = all
    seed: 42,
    concurrency: 3,
    minChars: 150,
    resume: false,
    model: process.env.OLLAMA_CHAT_MODEL ?? "llama3.2",
    ollamaBase: (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--store-dir") args.storeDir = next();
    else if (a === "--index-file") args.indexFile = next();
    else if (a === "--output" || a === "-o") args.output = next();
    else if (a === "--sample") args.sample = parseInt(next(), 10);
    else if (a === "--seed") args.seed = parseInt(next(), 10);
    else if (a === "--concurrency") args.concurrency = parseInt(next(), 10);
    else if (a === "--min-chars") args.minChars = parseInt(next(), 10);
    else if (a === "--model") args.model = next();
    else if (a === "--resume") args.resume = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const indexPath = resolve(root, args.storeDir, args.indexFile);
  const outputPath = resolve(process.cwd(), args.output);

  // Load index
  let indexRaw;
  try {
    indexRaw = readFileSync(indexPath, "utf8");
  } catch {
    console.error(`Cannot read index at ${indexPath}.\nRun 'npm run build && node dist/cli.js ingest <dir>' first.`);
    process.exit(1);
  }

  const index = JSON.parse(indexRaw);
  if (!Array.isArray(index.chunks)) {
    console.error("Index does not contain a chunks array. Re-ingest and try again.");
    process.exit(1);
  }

  // Filter short chunks
  const eligible = index.chunks.filter((c) => (c.text ?? "").length >= args.minChars);
  console.log(`Index: ${index.chunks.length} total chunks, ${eligible.length} eligible (≥${args.minChars} chars)`);

  // Resume: load existing dataset and skip already-generated IDs
  let existing = [];
  const existingIds = new Set();
  if (args.resume && existsSync(outputPath)) {
    try {
      const ex = JSON.parse(readFileSync(outputPath, "utf8"));
      existing = ex.items ?? [];
      for (const item of existing) existingIds.add(item.chunkId);
      console.log(`Resume: ${existingIds.size} existing item(s) loaded from ${outputPath}`);
    } catch (e) {
      console.warn(`Warning: could not load existing dataset (${e.message}); starting fresh`);
    }
  }

  // Sample
  const candidates = eligible.filter((c) => !existingIds.has(c.id));
  const toProcess = args.sample !== null
    ? sampleSeeded(candidates, args.sample, args.seed)
    : candidates;

  if (toProcess.length === 0) {
    console.log("Nothing to generate (all chunks already in dataset or no eligible chunks).");
    process.exit(0);
  }

  console.log(`Generating questions for ${toProcess.length} chunk(s) via ${args.model} @ ${args.ollamaBase}`);
  console.log(`Concurrency: ${args.concurrency} | Min chars: ${args.minChars} | Seed: ${args.seed}`);

  // Verify Ollama is reachable
  try {
    const ping = await fetch(`${args.ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!ping.ok) throw new Error(`status ${ping.status}`);
  } catch (e) {
    console.error(`\nOllama not reachable at ${args.ollamaBase}: ${e.message}`);
    console.error("Start Ollama and ensure OLLAMA_CHAT_MODEL is pulled:");
    console.error(`  ollama pull ${args.model}`);
    process.exit(1);
  }

  let done = 0;
  let skipped = 0;
  progressLine(0, toProcess.length, "starting…");

  const newItems = await mapPool(toProcess, args.concurrency, async (chunk, _i) => {
    try {
      const question = await generateQuestion(args.ollamaBase, args.model, chunk.text);
      if (!isValidQuestion(question)) {
        skipped++;
        progressLine(++done, toProcess.length, `[skip] ${chunk.metadata?.fileName ?? "?"}`);
        return null;
      }
      progressLine(++done, toProcess.length, chunk.metadata?.fileName ?? "?");
      return {
        chunkId: chunk.id,
        sourceFile: chunk.metadata?.fileName ?? "",
        page: chunk.metadata?.page ?? null,
        textPreview: chunk.text.slice(0, 120),
        question,
      };
    } catch (e) {
      skipped++;
      progressLine(++done, toProcess.length, `[error] ${chunk.metadata?.fileName ?? "?"}`);
      process.stderr.write(`\n  ! chunk ${chunk.id}: ${e.message}\n`);
      return null;
    }
  });

  process.stdout.write("\n");

  const valid = newItems.filter(Boolean);
  const allItems = [...existing, ...valid];

  const dataset = {
    version: 1,
    generated: new Date().toISOString(),
    generationModel: args.model,
    embeddingModel: index.embeddingModel ?? null,
    indexPath,
    totalGenerated: allItems.length,
    items: allItems,
  };

  writeFileSync(outputPath, JSON.stringify(dataset, null, 2), "utf8");

  console.log(`\nGenerated: ${valid.length}  Skipped/errors: ${skipped}`);
  console.log(`Total items in dataset: ${allItems.length}`);
  console.log(`Dataset written → ${outputPath}`);
  console.log(`\nNext: npm run eval:run`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
