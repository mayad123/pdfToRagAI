#!/usr/bin/env node
/**
 * Gold-dataset retrieval evaluator (F17).
 *
 * Loads a synthetic Q&A dataset produced by `eval:generate`, embeds each
 * question using the same model as the index, searches the vector store,
 * and measures whether the gold chunk (the one the question was generated
 * FROM) appears in the top-K results.
 *
 * Metrics reported:
 *   Hit@1  Hit@3  Hit@5  Hit@10   — fraction of queries where gold is in top K
 *   MRR                           — Mean Reciprocal Rank (1/rank of gold chunk)
 *   nDCG@10                       — normalized DCG for single-relevant-doc case
 *   Mean gold score               — avg cosine similarity when gold chunk is found
 *
 * The "hardest" cases (gold chunk ranks poorly or is not found) pinpoint
 * chunks that need richer context, different chunking, or a better model.
 *
 * Usage:
 *   npm run eval:run
 *   npm run eval:run -- --top-k 20 --diagnose
 *   npm run eval:run -- --dataset eval-dataset.json --report eval-results.json
 *   npm run eval:run -- --store-dir .pdf-to-rag-custom
 *   npm run eval:run -- --mmr --mmr-lambda 0.7 --report eval-mmr.json
 *
 * Env: same embedding env vars as ingest (PDF_TO_RAG_EMBED_BACKEND, OLLAMA_*, etc.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppDeps, defaultConfig, searchQuery } from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function hitAtK(rank, k) {
  return rank !== null && rank <= k ? 1 : 0;
}

function reciprocalRank(rank) {
  return rank !== null ? 1 / rank : 0;
}

/** nDCG@K for the single-relevant-document case: DCG = 1/log2(rank+1) if found. */
function ndcg(rank, k) {
  if (rank === null || rank > k) return 0;
  return 1 / Math.log2(rank + 1);
}

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function pct(v) {
  return v === null ? "  —  " : `${(v * 100).toFixed(1).padStart(5)}%`;
}

function fmt3(v) {
  return v === null ? " — " : v.toFixed(3);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    dataset: "eval-dataset.json",
    storeDir: ".pdf-to-rag",
    topK: 50,          // search depth — rank up to this position
    report: "eval-results.json",
    diagnose: false,
    diagnoseN: 10,
    mmr: false,
    mmrLambda: 0.5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--dataset" || a === "-d") args.dataset = next();
    else if (a === "--store-dir") args.storeDir = next();
    else if (a === "--top-k") args.topK = parseInt(next(), 10);
    else if (a === "--report" || a === "-r") args.report = next();
    else if (a === "--diagnose") args.diagnose = true;
    else if (a === "--diagnose-n") args.diagnoseN = parseInt(next(), 10);
    else if (a === "--mmr") args.mmr = true;
    else if (a === "--mmr-lambda") args.mmrLambda = parseFloat(next());
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Load dataset
  let dataset;
  try {
    dataset = JSON.parse(readFileSync(resolve(process.cwd(), args.dataset), "utf8"));
  } catch (e) {
    console.error(`Cannot read dataset at ${args.dataset}: ${e.message}`);
    console.error("Run 'npm run eval:generate' first.");
    process.exit(1);
  }

  const items = dataset.items ?? [];
  if (items.length === 0) {
    console.error("Dataset is empty. Re-run eval:generate.");
    process.exit(1);
  }

  console.log(`Dataset: ${items.length} item(s)  (generated ${dataset.generated ?? "unknown"})`);
  console.log(`Generation model: ${dataset.generationModel ?? "unknown"}`);
  console.log(`Search depth: top-${args.topK}`);
  if (args.mmr) console.log(`MMR: on (lambda=${args.mmrLambda})`);
  console.log("Loading embedding model and index…\n");

  // Create deps
  const config = defaultConfig({
    storeDir: args.storeDir,
    topK: args.topK,
    mmr: args.mmr,
    mmrLambda: args.mmrLambda,
  });
  const deps = await createAppDeps(root, config);
  await deps.store.load();

  const chunkCount = deps.store.getChunkCount();
  if (chunkCount === 0) {
    console.error("Index is empty. Run ingest first.");
    process.exit(1);
  }
  console.log(`Index loaded: ${chunkCount} chunk(s)\n`);

  // Check embedding model alignment
  const indexEmbModel = dataset.embeddingModel;
  if (indexEmbModel && indexEmbModel !== deps.config.embeddingModel) {
    console.warn(
      `Warning: dataset was generated against '${indexEmbModel}' but current model is '${deps.config.embeddingModel}'.`
    );
    console.warn("Consider re-generating the dataset for accurate results.\n");
  }

  // Evaluate
  const caseResults = [];
  let done = 0;

  for (const item of items) {
    // Retrieval: raw cosine (store.search) or production-aligned path (searchQuery: MMR / cross-encoder via env)
    let hits;
    if (args.mmr || process.env.PDF_TO_RAG_RERANK_MODEL?.trim()) {
      const qh = await searchQuery(
        item.question,
        { ...deps.config, topK: args.topK, mmr: args.mmr, mmrLambda: args.mmrLambda },
        deps.embedder,
        deps.store,
        undefined,
        undefined
      );
      hits = qh.map((h) => ({
        chunk: {
          id: h.chunkId,
          text: h.text,
          metadata: { fileName: h.fileName, page: h.page, id: h.chunkId },
        },
        score: h.score,
      }));
    } else {
      const queryVector = await deps.embedder.embedOne(item.question, "query");
      hits = deps.store.search(queryVector, args.topK);
    }

    // Find rank of gold chunk
    const rankIdx = hits.findIndex((h) => h.chunk.id === item.chunkId);
    const rank = rankIdx === -1 ? null : rankIdx + 1;
    const goldScore = rank !== null ? hits[rankIdx].score : null;
    const topHitScore = hits[0]?.score ?? null;

    caseResults.push({
      chunkId: item.chunkId,
      question: item.question,
      sourceFile: item.sourceFile,
      page: item.page,
      rank,
      goldScore,
      topHitScore,
      reciprocalRank: reciprocalRank(rank),
      ndcg10: ndcg(rank, 10),
      hitAt1: hitAtK(rank, 1),
      hitAt3: hitAtK(rank, 3),
      hitAt5: hitAtK(rank, 5),
      hitAt10: hitAtK(rank, 10),
    });

    done++;
    if (done % 10 === 0 || done === items.length) {
      process.stdout.write(`\r  Evaluated ${done}/${items.length}…`);
    }
  }
  process.stdout.write("\n\n");

  // Aggregate
  const n = caseResults.length;
  const found = caseResults.filter((r) => r.rank !== null);
  const notFound = n - found.length;

  const summary = {
    totalItems: n,
    notFound,
    hitAt1:  mean(caseResults.map((r) => r.hitAt1)),
    hitAt3:  mean(caseResults.map((r) => r.hitAt3)),
    hitAt5:  mean(caseResults.map((r) => r.hitAt5)),
    hitAt10: mean(caseResults.map((r) => r.hitAt10)),
    mrr:     mean(caseResults.map((r) => r.reciprocalRank)),
    ndcg10:  mean(caseResults.map((r) => r.ndcg10)),
    meanGoldScore: mean(found.map((r) => r.goldScore)),
    meanTopHitScore: mean(caseResults.map((r) => r.topHitScore)),
  };

  // Print summary
  const sep = "─".repeat(52);
  console.log(sep);
  console.log(`Retrieval eval — ${n} questions, search depth top-${args.topK}`);
  console.log(sep);
  console.log(`Hit@1:            ${pct(summary.hitAt1)}   (gold at rank 1)`);
  console.log(`Hit@3:            ${pct(summary.hitAt3)}   (gold in top 3)`);
  console.log(`Hit@5:            ${pct(summary.hitAt5)}   (gold in top 5)`);
  console.log(`Hit@10:           ${pct(summary.hitAt10)}   (gold in top 10)`);
  console.log(`MRR:              ${fmt3(summary.mrr)}   (mean reciprocal rank)`);
  console.log(`nDCG@10:          ${fmt3(summary.ndcg10)}   (normalized DCG)`);
  console.log(`Mean gold score:  ${fmt3(summary.meanGoldScore)}   (cosine when found)`);
  console.log(`Mean top score:   ${fmt3(summary.meanTopHitScore)}   (rank-1 cosine)`);
  console.log(`Not found:        ${notFound}/${n}   (gold chunk outside top ${args.topK})`);
  console.log(sep);

  // Hardest cases (worst rank / not found)
  const sorted = [...caseResults].sort((a, b) => {
    const ra = a.rank ?? args.topK + 1;
    const rb = b.rank ?? args.topK + 1;
    return rb - ra; // highest rank (worst) first
  });

  const hardN = Math.min(10, sorted.length);
  console.log(`\nHardest ${hardN} cases (gold ranked last or not found):`);
  for (const r of sorted.slice(0, hardN)) {
    const rankStr = r.rank !== null ? `rank=${r.rank}` : `NOT FOUND`;
    const scoreStr = r.goldScore !== null ? `score=${r.goldScore.toFixed(3)}` : "";
    console.log(`  ${rankStr.padEnd(12)} ${scoreStr.padEnd(13)} ${r.sourceFile} p.${r.page ?? "?"}`);
    console.log(`    Q: ${r.question.slice(0, 80)}${r.question.length > 80 ? "…" : ""}`);
  }

  // Diagnose: show full chunk text for hard cases
  if (args.diagnose) {
    console.log(`\n${"─".repeat(52)}`);
    console.log(`Diagnose: chunk text for hardest ${Math.min(args.diagnoseN, hardN)} case(s)`);
    console.log("─".repeat(52));
    // Need to read index to get chunk texts
    const indexPath = resolve(root, args.storeDir, "index.json");
    let chunkMap;
    try {
      const raw = readFileSync(indexPath, "utf8");
      const idx = JSON.parse(raw);
      chunkMap = new Map((idx.chunks ?? []).map((c) => [c.id, c.text]));
    } catch {
      console.warn("Could not load index for diagnosis.");
    }
    for (const r of sorted.slice(0, args.diagnoseN)) {
      const text = chunkMap?.get(r.chunkId) ?? "(text not available)";
      const rankStr = r.rank !== null ? `rank=${r.rank}` : "NOT FOUND";
      console.log(`\n[${rankStr}] ${r.sourceFile} p.${r.page ?? "?"}`);
      console.log(`Q: ${r.question}`);
      console.log(`Text (${text.length} chars):`);
      console.log(`  ${text.slice(0, 400).replace(/\n/g, " ")}${text.length > 400 ? "…" : ""}`);
    }
  }

  // Write JSON report
  const reportPath = resolve(process.cwd(), args.report);
  const report = {
    version: 1,
    timestamp: new Date().toISOString(),
    datasetPath: args.dataset,
    storeDir: args.storeDir,
    embeddingModel: deps.config.embeddingModel,
    searchDepth: args.topK,
    mmr: args.mmr,
    mmrLambda: args.mmrLambda,
    rerankModel: process.env.PDF_TO_RAG_RERANK_MODEL?.trim() || null,
    summary,
    hardestCases: sorted.slice(0, 20).map((r) => ({
      chunkId: r.chunkId,
      question: r.question,
      sourceFile: r.sourceFile,
      page: r.page,
      rank: r.rank,
      goldScore: r.goldScore,
    })),
    allCases: caseResults.map((r) => ({
      chunkId: r.chunkId,
      sourceFile: r.sourceFile,
      page: r.page,
      rank: r.rank,
      goldScore: r.goldScore,
      reciprocalRank: r.reciprocalRank,
      ndcg10: r.ndcg10,
    })),
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nReport written → ${reportPath}`);
  console.log("Next: npm run eval:compare -- before.json after.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
