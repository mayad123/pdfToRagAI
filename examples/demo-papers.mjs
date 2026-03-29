#!/usr/bin/env node
/**
 * Phase 7 (D9): scripted walkthrough — ingest a small corpus and print cited hits for several questions.
 *
 * Prerequisites:
 *   npm run build
 *   At least one .pdf under examples/ (see examples/README.md)
 *
 * Usage:
 *   node examples/demo-papers.mjs
 *   npm run demo:papers
 *
 * Uses the library with createNoOpHooks (same stack as MCP/CLI). Honors PDF_TO_RAG_EMBED_BACKEND / Ollama env like other tools.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNoOpHooks,
  createAppDeps,
  defaultConfig,
  runIngest,
  runQuery,
} from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(root, "examples");

function findSmallestPdf() {
  let names;
  try {
    names = readdirSync(examplesDir);
  } catch {
    throw new Error(`Missing ${examplesDir}`);
  }
  const pdfs = names.filter((n) => n.endsWith(".pdf") && !n.startsWith("."));
  if (pdfs.length === 0) {
    throw new Error(`No .pdf files in ${examplesDir}. Add PDFs or run from a full clone.`);
  }
  let best = pdfs[0];
  let bestSize = statSync(join(examplesDir, best)).size;
  for (let i = 1; i < pdfs.length; i++) {
    const n = pdfs[i];
    const s = statSync(join(examplesDir, n)).size;
    if (s < bestSize) {
      bestSize = s;
      best = n;
    }
  }
  return { name: best, abs: join(examplesDir, best) };
}

function formatCitation(hit, rank) {
  const preview =
    hit.text.length > 220 ? `${hit.text.slice(0, 220)}…` : hit.text;
  return [
    `  [${rank}] ${hit.fileName} · page ${hit.page} · score=${typeof hit.score === "number" ? hit.score.toFixed(4) : hit.score}`,
    `      “${preview.replace(/\s+/g, " ").trim()}”`,
  ].join("\n");
}

const { name: pdfName, abs: pdfPath } = findSmallestPdf();
const corpusTmp = mkdtempSync(join(tmpdir(), "pdf-to-rag-demo-corpus-"));
const storeDir = join(tmpdir(), `pdf-to-rag-demo-store-${Date.now()}`);
copyFileSync(pdfPath, join(corpusTmp, pdfName));

const questions = [
  "Summarize the main topic of this document in one sentence.",
  "What definitions or key terms are introduced early in the text?",
  "What methods, experiments, or evidence are described?",
  "What conclusions or implications are stated toward the end?",
];

console.log("pdf-to-rag demo — research-style questions on one example PDF\n");
console.log(`Corpus: ${join(corpusTmp, pdfName)} (smallest PDF from examples/)\n`);

const hooks = createNoOpHooks();
const config = defaultConfig({ storeDir, topK: 4 });
const deps = await createAppDeps(root, config);

try {
  const ingestResult = await runIngest(corpusTmp, root, deps, hooks);
  console.log(
    `Ingest: ${ingestResult.filesProcessed} file(s), ${ingestResult.chunksIndexed} chunks, store under ${storeDir}\n`
  );

  for (const q of questions) {
    console.log(`Q: ${q}`);
    const hits = await runQuery(q, deps, hooks);
    if (!hits.length) {
      console.log("  (no hits)\n");
      continue;
    }
    hits.forEach((h, i) => console.log(formatCitation(h, i + 1)));
    console.log("");
  }
} finally {
  rmSync(corpusTmp, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
}

console.log("Done. For JSON fixtures and stricter checks, see npm run examples:fixtures.");
