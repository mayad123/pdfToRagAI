#!/usr/bin/env node
/**
 * JSON-driven NL query checks against an ingested examples/ corpus.
 * Uses the library (dist) for structured QueryHit assertions — verbatim substrings, file/page, hit counts.
 *
 * **Assertion semantics:** For each case, chunks are ranked by embedding similarity to the question
 * and **all chunks** are considered when checking `textContains` / `minHits` / etc. (not only
 * `defaults.topK`). The `topK` field in JSON still configures `PdfToRagConfig` for the app deps;
 * substring checks intentionally use the full ranked list so large `examples/` trees pass without
 * editing expected quotes. Set `expect.relaxApostrophes` to `false` to require exact apostrophe bytes.
 *
 * Usage:
 *   npm run build
 *   npm run examples:fixtures
 *   npm run examples:fixtures -- /path/to/fixtures.json --verbose
 *
 * Env: PDF_TO_RAG_FIXTURES_VERBOSE=1 — print hit previews on failure.
 */
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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

const corpusSchema = z
  .object({
    mode: z.enum(["smallest", "all"]).default("smallest"),
    sourceDir: z.string().optional(),
    /** If set, only these PDF basenames are copied (stable subset; avoids ranking dilution from huge trees). */
    pinnedFiles: z.array(z.string().min(1)).optional(),
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
    /** Each string must appear in some ranked hit text (runner uses full chunk list, similarity-ranked). */
    textContains: z.array(z.string().min(1)).optional(),
    /** Each string must appear in the same single hit text. */
    textContainsAllInOneHit: z.array(z.string().min(1)).optional(),
    /**
     * Each string must appear somewhere in the full index (ingest / PDF text correctness).
     * Does not prove the query retrieved it; combine with textContains when you need both.
     */
    textContainsInCorpus: z.array(z.string().min(1)).optional(),
    /**
     * Normalize Unicode apostrophes to ASCII ' for substring matching.
     * Default in this runner: **true** unless set to `false`.
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

function normText(s, insensitive) {
  return insensitive ? s.toLowerCase() : s;
}

/** Map common curly apostrophes / backtick to ASCII for fuzzy quote matching. */
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

function assertCase(hits, c, defaultTopK, corpusTexts) {
  const topK = c.topK ?? defaultTopK;
  const ex = c.expect;
  const ins = c.caseInsensitive === true || ex.caseInsensitive === true;
  const relaxApos = ex.relaxApostrophes !== false;

  if (hits.length > topK) {
    throw new Error(`Internal: got ${hits.length} hits but topK=${topK}`);
  }

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
          `textContainsInCorpus: no indexed chunk contains ${JSON.stringify(needle)} (caseInsensitive=${ins}, relaxApostrophes=${relaxApos})`
        );
      }
    }
  }

  if (ex.textContains?.length) {
    for (const needle of ex.textContains) {
      const ok = hits.some((h) => includesHay(h.text, needle, ins, relaxApos));
      if (!ok) {
        throw new Error(
          `textContains: no hit text includes ${JSON.stringify(needle)} (caseInsensitive=${ins}, relaxApostrophes=${relaxApos})`
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
}

function parseArgv(argv) {
  const paths = [];
  let verbose = process.env.PDF_TO_RAG_FIXTURES_VERBOSE === "1";
  for (const a of argv) {
    if (a === "--verbose" || a === "-v") verbose = true;
    else if (!a.startsWith("-")) paths.push(a);
  }
  return { fixturePathArg: paths[0], verbose };
}

async function main() {
  const argv = process.argv.slice(2);
  const { fixturePathArg, verbose } = parseArgv(argv);
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
    console.log(`ingest ok (${label}): ${ingestResult.chunksIndexed} chunks`);
    const corpusTexts = loadIndexChunkTexts(ingestResult.storePath);

    await deps.store.load();
    const chunkN = deps.store.getChunkCount();
    const searchTopK = Math.max(1, chunkN);

    let failed = 0;
    for (const c of data.cases) {
      const caseConfig =
        c.topK !== undefined ? defaultConfig({ ...overrides, topK: c.topK }) : config;
      const wideConfig = { ...caseConfig, topK: searchTopK };
      let hits = [];
      try {
        await hooks.beforeQuery({ question: c.query });
        hits = await searchQuery(c.query, wideConfig, deps.embedder, deps.store);
        assertCase(hits, c, wideConfig.topK, corpusTexts);
        console.log(`  ✓ ${c.id} (${hits.length} hit(s))`);
      } catch (err) {
        failed++;
        console.error(`  ✗ ${c.id}: ${err?.message ?? err}`);
        if (verbose || process.env.PDF_TO_RAG_FIXTURES_VERBOSE === "1") {
          if (hits.length > 0) printHitDebug(hits.slice(0, 5), c.id);
        }
      }
    }

    if (failed > 0) {
      console.error(`\n${failed} case(s) failed.`);
      console.error(
        "Tip: use --verbose or PDF_TO_RAG_FIXTURES_VERBOSE=1; confirm substrings exist in the PDFs under corpus.sourceDir; set expect.relaxApostrophes to false only for strict apostrophe bytes. See examples/README.md § Query fixtures."
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
