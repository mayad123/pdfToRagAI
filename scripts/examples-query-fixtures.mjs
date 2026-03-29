#!/usr/bin/env node
/**
 * JSON-driven NL query checks against an ingested examples/ corpus.
 * Uses the library (dist) for structured QueryHit assertions — verbatim substrings, file/page, hit counts.
 *
 * ## Assertion levels (precision pyramid)
 *
 * Level 1 — Existence   (textContains / textContainsInCorpus)
 *   Does the relevant text exist anywhere in the ranked list?
 *   Tests ingest quality and baseline recall. Low bar.
 *
 * Level 2 — Rank        (inTopK)
 *   Does the first relevant hit appear at rank ≤ N?
 *   Tests retrieval ranking quality. This is precision.
 *
 * Level 3 — Score       (minScore)
 *   Does the first relevant hit have cosine similarity ≥ threshold?
 *   Tests embedding alignment and retrieval confidence.
 *
 * Level 4 — Top-hit     (topHit)
 *   Is the rank-1 result the expected answer?
 *   Tests precision@1 — the strictest assertion.
 *
 * ## Metrics printed after every run
 *   MRR (Mean Reciprocal Rank), mean first-relevant score,
 *   P@3/P@5/P@10 (fraction of cases with a relevant hit in top K).
 *
 * ## Flags
 *   --calibrate        Skip inTopK/minScore/topHit assertions; show metrics only.
 *                      Use this when adding a new PDF to discover real rank/score values
 *                      before committing hard thresholds to the fixture file.
 *   --report [file]    Write a JSON eval report (default: eval-report.json).
 *   --verbose / -v     Print top-hit previews on failure.
 *
 * Usage:
 *   npm run build
 *   npm run examples:fixtures
 *   npm run examples:fixtures -- --calibrate --verbose
 *   npm run examples:fixtures -- --report eval-report.json
 *   npm run examples:fixtures -- /path/to/fixtures.json --verbose
 *
 * Env: PDF_TO_RAG_FIXTURES_VERBOSE=1 — print hit previews on failure.
 */
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createNoOpHooks,
  createAppDeps,
  defaultConfig,
  runIngest,
  searchQuery,
} from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const corpusSchema = z
  .object({
    mode: z.enum(["smallest", "all"]).default("smallest"),
    sourceDir: z.string().optional(),
    /** If set, only these PDF basenames are copied (stable subset; avoids ranking dilution from huge trees). */
    pinnedFiles: z.array(z.string().min(1)).optional(),
  })
  .strict();

const topHitSchema = z
  .object({
    /** Every string must appear in the rank-1 hit's text (precision@1). */
    textContains: z.array(z.string().min(1)).optional(),
    /** Rank-1 hit must have cosine similarity ≥ this value. */
    minScore: z.number().min(0).max(1).optional(),
  })
  .strict();

const expectSchema = z
  .object({
    minHits: z.number().int().nonnegative().optional(),
    maxHits: z.number().int().positive().optional(),
    /** At least this many unique hit fileName values (cross-document retrieval checks). */
    minDistinctFiles: z.number().int().positive().optional(),
    /** When true (here or on the parent case), substring and file-name checks ignore case. */
    caseInsensitive: z.boolean().optional(),
    /** Each string must appear in some ranked hit text (full similarity-ranked list). */
    textContains: z.array(z.string().min(1)).optional(),
    /** Each string must appear in the same single hit text. */
    textContainsAllInOneHit: z.array(z.string().min(1)).optional(),
    /** Each string must appear somewhere in the full index (ingest / PDF text correctness). */
    textContainsInCorpus: z.array(z.string().min(1)).optional(),
    /**
     * Normalize Unicode apostrophes to ASCII ' for substring matching.
     * Default in this runner: true unless set to false.
     */
    relaxApostrophes: z.boolean().optional(),
    fileName: z.string().min(1).optional(),
    fileNameIncludes: z.string().min(1).optional(),
    page: z
      .union([
        z.number().int().positive(),
        z.object({
          gte: z.number().int().positive().optional(),
          lte: z.number().int().positive().optional(),
        }),
      ])
      .optional(),
    /**
     * [Level 2 — Rank] First relevant hit (per textContains) must be at rank ≤ this.
     * Skipped in --calibrate mode.
     */
    inTopK: z.number().int().positive().optional(),
    /**
     * [Level 3 — Score] First relevant hit must have cosine similarity ≥ this value.
     * Skipped in --calibrate mode.
     */
    minScore: z.number().min(0).max(1).optional(),
    /**
     * [Level 4 — Top-hit] Assertions on the rank-1 result specifically.
     * Skipped in --calibrate mode.
     */
    topHit: topHitSchema.optional(),
  })
  .strict();

const caseSchema = z
  .object({
    id: z.string().min(1),
    query: z.string().min(1),
    topK: z.number().int().positive().optional(),
    caseInsensitive: z.boolean().optional(),
    expect: expectSchema,
  })
  .strict();

const fileSchema = z
  .object({
    version: z.literal(1).optional(),
    corpus: corpusSchema.default({ mode: "smallest" }),
    ingest: z
      .object({
        chunkSize: z.number().int().positive().optional(),
        overlap: z.number().int().nonnegative().optional(),
        recursive: z.boolean().optional(),
      })
      .optional(),
    defaults: z
      .object({
        topK: z.number().int().positive().optional(),
        storeDir: z.string().optional(),
      })
      .optional(),
    cases: z.array(caseSchema).min(1),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Corpus helpers
// ---------------------------------------------------------------------------

function listPdfs(examplesDir) {
  let names;
  try {
    names = readdirSync(examplesDir);
  } catch (e) {
    throw new Error(`Cannot read corpus directory ${examplesDir}: ${e}`);
  }
  return names.filter((n) => n.endsWith(".pdf") && !n.startsWith("."));
}

function findSmallestPdf(examplesDir) {
  const pdfs = listPdfs(examplesDir);
  if (pdfs.length === 0) {
    throw new Error(`No .pdf files in ${examplesDir}. Add PDFs or fix sourceDir in the fixture JSON.`);
  }
  let bestName = pdfs[0];
  let bestSize = statSync(join(examplesDir, bestName)).size;
  for (let i = 1; i < pdfs.length; i++) {
    const n = pdfs[i];
    const s = statSync(join(examplesDir, n)).size;
    if (s < bestSize) {
      bestSize = s;
      bestName = n;
    }
  }
  return { name: bestName, path: join(examplesDir, bestName) };
}

function prepareCorpusTmp(examplesDir, corpus) {
  const tmp = mkdtempSync(join(tmpdir(), "pdf-to-rag-query-fixtures-"));
  if (corpus.pinnedFiles?.length) {
    const label = [];
    for (const base of corpus.pinnedFiles) {
      const src = join(examplesDir, base);
      try {
        if (!statSync(src).isFile()) throw new Error("not a file");
      } catch {
        throw new Error(`pinnedFiles: missing or not a file: ${src}`);
      }
      copyFileSync(src, join(tmp, base));
      label.push(base);
    }
    return { tmp, label: `pinned: ${label.join(", ")}` };
  }
  if (corpus.mode === "smallest") {
    const { name, path: pdfPath } = findSmallestPdf(examplesDir);
    copyFileSync(pdfPath, join(tmp, name));
    return { tmp, label: `smallest: ${name}` };
  }
  const pdfs = listPdfs(examplesDir);
  for (const n of pdfs) {
    copyFileSync(join(examplesDir, n), join(tmp, n));
  }
  return { tmp, label: `all ${pdfs.length} PDF(s)` };
}

// ---------------------------------------------------------------------------
// Text matching helpers
// ---------------------------------------------------------------------------

function normText(s, insensitive) {
  return insensitive ? s.toLowerCase() : s;
}

function relaxApostrophesStr(s) {
  return s.replace(/\u2019|\u2018|\u02bc|\u0060/g, "'");
}

function includesHay(hay, needle, insensitive, relaxApos) {
  const h = relaxApos ? relaxApostrophesStr(hay) : hay;
  const n = relaxApos ? relaxApostrophesStr(needle) : needle;
  return normText(h, insensitive).includes(normText(n, insensitive));
}

function pageOk(page, spec) {
  if (typeof spec === "number") return page === spec;
  if (spec.gte !== undefined && page < spec.gte) return false;
  if (spec.lte !== undefined && page > spec.lte) return false;
  return true;
}

function loadIndexChunkTexts(storePath) {
  const raw = readFileSync(storePath, "utf8");
  const parsed = JSON.parse(raw);
  const chunks = parsed.chunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.map((c) => (typeof c.text === "string" ? c.text : ""));
}

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

/**
 * Compute per-case retrieval metrics using textContains as the relevance signal.
 * A hit is "relevant" if its text includes any of the expected strings.
 * Returns null for metrics that cannot be computed (e.g. no textContains defined).
 */
function computeCaseMetrics(hits, ex, ins, relaxApos) {
  const metrics = {
    totalHits: hits.length,
    topHitScore: hits[0]?.score ?? null,
    firstRelevantRank: null,
    firstRelevantScore: null,
    reciprocalRank: 0,
    precisionAt3: null,
    precisionAt5: null,
    precisionAt10: null,
  };

  if (!ex.textContains?.length) return metrics;

  const relevanceFlags = hits.map((h) =>
    ex.textContains.some((n) => includesHay(h.text, n, ins, relaxApos))
  );

  const firstIdx = relevanceFlags.indexOf(true);
  if (firstIdx !== -1) {
    metrics.firstRelevantRank = firstIdx + 1;
    metrics.firstRelevantScore = hits[firstIdx].score;
    metrics.reciprocalRank = 1 / (firstIdx + 1);
  }

  for (const k of [3, 5, 10]) {
    if (hits.length >= k) {
      const relevant = relevanceFlags.slice(0, k).filter(Boolean).length;
      metrics[`precisionAt${k}`] = relevant / k;
    }
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Debug output
// ---------------------------------------------------------------------------

function printHitDebug(hits, caseId) {
  console.error(`  [debug] case ${caseId}: top ${Math.min(5, hits.length)} hit(s):`);
  for (let i = 0; i < Math.min(5, hits.length); i++) {
    const h = hits[i];
    const preview = h.text.replace(/\s+/g, " ").slice(0, 200);
    console.error(
      `    #${i + 1} score=${h.score.toFixed(4)} ${h.fileName} p.${h.page} — ${preview}${h.text.length > 200 ? "…" : ""}`
    );
  }
}

function fmtScore(v) {
  return v !== null && v !== undefined ? v.toFixed(4) : "—";
}

function fmtRank(v) {
  return v !== null && v !== undefined ? String(v) : "—";
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Run all assertions for a case. Throws on failure.
 * Pass calibrate=true to skip Level 2/3/4 (inTopK, minScore, topHit) assertions.
 */
function runAssertions(hits, c, defaultTopK, corpusTexts, metrics, calibrate) {
  const topK = c.topK ?? defaultTopK;
  const ex = c.expect;
  const ins = c.caseInsensitive === true || ex.caseInsensitive === true;
  const relaxApos = ex.relaxApostrophes !== false;

  if (hits.length > topK) {
    throw new Error(`Internal: got ${hits.length} hits but topK=${topK}`);
  }

  // --- Level 1: Existence ---

  if (ex.minHits !== undefined && hits.length < ex.minHits) {
    throw new Error(`minHits: expected ≥${ex.minHits}, got ${hits.length}`);
  }
  if (ex.maxHits !== undefined && hits.length > ex.maxHits) {
    throw new Error(`maxHits: expected ≤${ex.maxHits}, got ${hits.length}`);
  }

  if (ex.minDistinctFiles !== undefined) {
    const files = new Set(hits.map((h) => h.fileName));
    if (files.size < ex.minDistinctFiles) {
      throw new Error(
        `minDistinctFiles: expected ≥${ex.minDistinctFiles} unique fileName in hits, got ${files.size} (${[...files].join(", ")})`
      );
    }
  }

  if (ex.textContainsInCorpus?.length) {
    for (const needle of ex.textContainsInCorpus) {
      const ok = corpusTexts.some((t) => includesHay(t, needle, ins, relaxApos));
      if (!ok) {
        throw new Error(
          `textContainsInCorpus: no indexed chunk contains ${JSON.stringify(needle)}`
        );
      }
    }
  }

  if (ex.textContains?.length) {
    for (const needle of ex.textContains) {
      const ok = hits.some((h) => includesHay(h.text, needle, ins, relaxApos));
      if (!ok) {
        throw new Error(
          `textContains: no hit text includes ${JSON.stringify(needle)} (caseInsensitive=${ins})`
        );
      }
    }
  }

  if (ex.textContainsAllInOneHit?.length) {
    const needles = ex.textContainsAllInOneHit;
    const ok = hits.some((h) => needles.every((n) => includesHay(h.text, n, ins, relaxApos)));
    if (!ok) {
      throw new Error(
        `textContainsAllInOneHit: no single hit contains all of: ${needles.map((n) => JSON.stringify(n)).join(", ")}`
      );
    }
  }

  if (ex.fileName !== undefined) {
    const ok = ins
      ? hits.some((h) => normText(h.fileName, true) === normText(ex.fileName, true))
      : hits.some((h) => h.fileName === ex.fileName);
    if (!ok) {
      throw new Error(`fileName: expected some hit with fileName=${JSON.stringify(ex.fileName)}`);
    }
  }

  if (ex.fileNameIncludes !== undefined) {
    const ok = hits.some((h) => includesHay(h.fileName, ex.fileNameIncludes, ins, false));
    if (!ok) {
      throw new Error(
        `fileNameIncludes: expected some hit whose fileName includes ${JSON.stringify(ex.fileNameIncludes)}`
      );
    }
  }

  if (ex.page !== undefined) {
    const ok = hits.some((h) => pageOk(h.page, ex.page));
    if (!ok) {
      throw new Error(`page: no hit matched spec ${JSON.stringify(ex.page)}`);
    }
  }

  // --- Level 2: Rank (skip in calibrate mode) ---

  if (!calibrate && ex.inTopK !== undefined) {
    const rank = metrics.firstRelevantRank;
    if (rank === null) {
      throw new Error(`inTopK: no relevant hit found in ranked list (textContains required)`);
    }
    if (rank > ex.inTopK) {
      throw new Error(
        `inTopK: first relevant hit at rank ${rank}, expected ≤${ex.inTopK}`
      );
    }
  }

  // --- Level 3: Score (skip in calibrate mode) ---

  if (!calibrate && ex.minScore !== undefined) {
    const score = metrics.firstRelevantScore;
    if (score === null) {
      throw new Error(`minScore: no relevant hit found to check score (textContains required)`);
    }
    if (score < ex.minScore) {
      throw new Error(
        `minScore: first relevant hit score ${score.toFixed(4)} < ${ex.minScore}`
      );
    }
  }

  // --- Level 4: Top-hit (skip in calibrate mode) ---

  if (!calibrate && ex.topHit !== undefined) {
    const top = hits[0];
    if (!top) {
      throw new Error(`topHit: no hits returned`);
    }
    if (ex.topHit.textContains?.length) {
      for (const n of ex.topHit.textContains) {
        if (!includesHay(top.text, n, ins, relaxApos)) {
          throw new Error(
            `topHit.textContains: rank-1 hit does not contain ${JSON.stringify(n)}`
          );
        }
      }
    }
    if (ex.topHit.minScore !== undefined && top.score < ex.topHit.minScore) {
      throw new Error(
        `topHit.minScore: rank-1 score ${top.score.toFixed(4)} < ${ex.topHit.minScore}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

function computeAggregate(caseResults) {
  const withRR = caseResults.filter((r) => r.reciprocalRank > 0);
  const mrr = withRR.length > 0
    ? withRR.reduce((s, r) => s + r.reciprocalRank, 0) / caseResults.length
    : 0;

  const withScore = caseResults.filter((r) => r.firstRelevantScore !== null);
  const meanFirstScore =
    withScore.length > 0
      ? withScore.reduce((s, r) => s + r.firstRelevantScore, 0) / withScore.length
      : null;

  const withTopHit = caseResults.filter((r) => r.topHitScore !== null);
  const meanTopHitScore =
    withTopHit.length > 0
      ? withTopHit.reduce((s, r) => s + r.topHitScore, 0) / withTopHit.length
      : null;

  const withRank = caseResults.filter((r) => r.firstRelevantRank !== null);
  const pAtK = {};
  for (const k of [3, 5, 10]) {
    const inTopK = withRank.filter((r) => r.firstRelevantRank <= k).length;
    pAtK[k] = withRank.length > 0 ? inTopK / withRank.length : null;
  }

  return { mrr, meanFirstScore, meanTopHitScore, pAtK, withRankCount: withRank.length };
}

function printMetricsSummary(caseResults, aggregate, calibrate) {
  const n = caseResults.length;
  const passed = caseResults.filter((r) => r.passed).length;
  const modeNote = calibrate ? " (calibrate mode — rank/score/top-hit assertions skipped)" : "";

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Eval metrics — ${n} case(s)${modeNote}`);
  console.log(`${"─".repeat(60)}`);
  if (aggregate.mrr > 0) {
    console.log(`MRR:                 ${aggregate.mrr.toFixed(3)}`);
  }
  if (aggregate.meanFirstScore !== null) {
    console.log(`Mean 1st-rel score:  ${aggregate.meanFirstScore.toFixed(3)}`);
  }
  if (aggregate.meanTopHitScore !== null) {
    console.log(`Mean top-hit score:  ${aggregate.meanTopHitScore.toFixed(3)}`);
  }
  for (const k of [3, 5, 10]) {
    const p = aggregate.pAtK[k];
    if (p !== null && aggregate.withRankCount > 0) {
      const count = Math.round(p * aggregate.withRankCount);
      console.log(
        `P@${k}:                ${(p * 100).toFixed(0).padStart(3)}%  (${count}/${aggregate.withRankCount} cases relevant in top ${k})`
      );
    }
  }

  console.log(`\nPer-case:`);
  for (const r of caseResults) {
    const rankStr = r.firstRelevantRank !== null ? `rank=${r.firstRelevantRank}` : "rank=—";
    const scoreStr = r.firstRelevantScore !== null ? `score=${fmtScore(r.firstRelevantScore)}` : "score=—";
    const rrStr = r.reciprocalRank > 0 ? `RR=${r.reciprocalRank.toFixed(3)}` : "RR=0";
    const statusMark = r.passed ? "✓" : "✗";
    const id = r.id.padEnd(35);
    const failNote = !r.passed && r.failReason ? `  ← ${r.failReason}` : "";
    console.log(`  ${statusMark} ${id} ${rankStr.padEnd(8)} ${scoreStr.padEnd(13)} ${rrStr}${failNote}`);
  }
  console.log(`${"─".repeat(60)}`);
  console.log(`Pass rate: ${passed}/${n}`);
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  const paths = [];
  let verbose = process.env.PDF_TO_RAG_FIXTURES_VERBOSE === "1";
  let calibrate = false;
  let reportPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verbose" || a === "-v") {
      verbose = true;
    } else if (a === "--calibrate" || a === "-c") {
      calibrate = true;
    } else if (a === "--report") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        reportPath = next;
        i++;
      } else {
        reportPath = "eval-report.json";
      }
    } else if (!a.startsWith("-")) {
      paths.push(a);
    }
  }
  return { fixturePathArg: paths[0], verbose, calibrate, reportPath };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const { fixturePathArg, verbose, calibrate, reportPath } = parseArgv(argv);
  const fixturePath = fixturePathArg
    ? resolve(process.cwd(), fixturePathArg)
    : join(root, "examples", "query-fixtures.json");
  let raw;
  try {
    raw = readFileSync(fixturePath, "utf8");
  } catch (e) {
    console.error(
      `Cannot read ${fixturePath}.\nExpected examples/query-fixtures.json in the repo or pass:\n  npm run examples:fixtures -- ./path/to/fixtures.json`
    );
    console.error(e);
    process.exit(1);
  }

  let data;
  try {
    data = fileSchema.parse(JSON.parse(raw));
  } catch (e) {
    console.error(`Invalid fixture JSON (${fixturePath}):`, e);
    process.exit(1);
  }

  const sourceRel = data.corpus.sourceDir ?? "examples";
  const examplesDir = resolve(root, sourceRel);
  const defaultTopK = data.defaults?.topK ?? 8;
  const storeDir = data.defaults?.storeDir ?? ".pdf-to-rag-examples-fixtures";

  const overrides = {
    storeDir,
    topK: defaultTopK,
    ...(data.ingest?.chunkSize !== undefined ? { chunkSize: data.ingest.chunkSize } : {}),
    ...(data.ingest?.overlap !== undefined ? { chunkOverlap: data.ingest.overlap } : {}),
    ...(data.ingest?.recursive !== undefined ? { recursive: data.ingest.recursive } : {}),
  };

  const config = defaultConfig(overrides);
  const hooks = createNoOpHooks();
  const { tmp, label } = prepareCorpusTmp(examplesDir, data.corpus);

  try {
    const deps = await createAppDeps(root, config);
    const ingestResult = await runIngest(tmp, root, deps, hooks);
    const skippedNote =
      ingestResult.filesSkipped > 0 ? ` (${ingestResult.filesSkipped} unchanged, skipped)` : "";
    console.log(`ingest ok (${label}): ${ingestResult.chunksIndexed} chunk(s)${skippedNote}`);
    const corpusTexts = loadIndexChunkTexts(ingestResult.storePath);

    await deps.store.load();
    const chunkN = deps.store.getChunkCount();
    const searchTopK = Math.max(1, chunkN);

    const caseResults = [];
    let failed = 0;

    for (const c of data.cases) {
      const caseConfig =
        c.topK !== undefined ? defaultConfig({ ...overrides, topK: c.topK }) : config;
      const wideConfig = { ...caseConfig, topK: searchTopK };
      const ex = c.expect;
      const ins = c.caseInsensitive === true || ex.caseInsensitive === true;
      const relaxApos = ex.relaxApostrophes !== false;

      let hits = [];
      let passedCase = true;
      let failReason = null;

      try {
        await hooks.beforeQuery({ question: c.query });
        hits = await searchQuery(c.query, wideConfig, deps.embedder, deps.store);
      } catch (err) {
        passedCase = false;
        failReason = `search error: ${err?.message ?? err}`;
      }

      const metrics = computeCaseMetrics(hits, ex, ins, relaxApos);

      if (passedCase) {
        try {
          runAssertions(hits, c, wideConfig.topK, corpusTexts, metrics, calibrate);
        } catch (err) {
          passedCase = false;
          failReason = err?.message ?? String(err);
        }
      }

      const rankStr = metrics.firstRelevantRank !== null ? `rank=${metrics.firstRelevantRank}` : "rank=—";
      const scoreStr =
        metrics.firstRelevantScore !== null
          ? `score=${fmtScore(metrics.firstRelevantScore)}`
          : "score=—";

      if (passedCase) {
        console.log(`  ✓ ${c.id.padEnd(35)} ${rankStr.padEnd(8)} ${scoreStr}`);
      } else {
        failed++;
        const rankInfo =
          metrics.firstRelevantRank !== null ? ` (${rankStr}, ${scoreStr})` : "";
        console.error(`  ✗ ${c.id}: ${failReason}${rankInfo}`);
        if ((verbose || process.env.PDF_TO_RAG_FIXTURES_VERBOSE === "1") && hits.length > 0) {
          printHitDebug(hits, c.id);
        }
      }

      caseResults.push({
        id: c.id,
        passed: passedCase,
        failReason,
        ...metrics,
      });
    }

    // Aggregate metrics
    const aggregate = computeAggregate(caseResults);
    printMetricsSummary(caseResults, aggregate, calibrate);

    // Optional JSON report
    if (reportPath) {
      const report = {
        timestamp: new Date().toISOString(),
        fixturePath,
        corpus: label,
        chunksIndexed: ingestResult.chunksIndexed,
        calibrate,
        summary: {
          totalCases: data.cases.length,
          passed: data.cases.length - failed,
          failed,
          passRate: (data.cases.length - failed) / data.cases.length,
          mrr: aggregate.mrr,
          meanFirstRelevantScore: aggregate.meanFirstScore,
          meanTopHitScore: aggregate.meanTopHitScore,
          precisionAt3: aggregate.pAtK[3],
          precisionAt5: aggregate.pAtK[5],
          precisionAt10: aggregate.pAtK[10],
        },
        cases: caseResults.map((r) => ({
          id: r.id,
          passed: r.passed,
          ...(r.failReason ? { failReason: r.failReason } : {}),
          firstRelevantRank: r.firstRelevantRank,
          firstRelevantScore: r.firstRelevantScore,
          topHitScore: r.topHitScore,
          reciprocalRank: r.reciprocalRank,
          precisionAt3: r.precisionAt3,
          precisionAt5: r.precisionAt5,
          precisionAt10: r.precisionAt10,
        })),
      };
      const reportAbs = resolve(process.cwd(), reportPath);
      writeFileSync(reportAbs, JSON.stringify(report, null, 2), "utf8");
      console.log(`\nReport written → ${reportAbs}`);
    }

    if (failed > 0) {
      console.error(
        `\n${failed} case(s) failed.\nTip: run with --calibrate to skip rank/score assertions and see raw metrics.\nRun with --verbose to see hit previews. See docs/management/project.md (Testing and evaluation methodology).`
      );
      process.exit(1);
    }
    console.log(`\nexamples:fixtures ok (${data.cases.length} case(s), ${fixturePath})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
