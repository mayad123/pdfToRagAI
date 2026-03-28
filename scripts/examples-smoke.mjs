#!/usr/bin/env node
/**
 * End-to-end check: pick the smallest top-level PDF in examples/, ingest a temp copy,
 * query, assert we get ranked hits. Uses a dedicated store dir under the repo root.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(root, "examples");
/** Relative to `root` so argv is space-safe when the repo path contains spaces (e.g. "GitHub Projects"). */
const storeDirRel = ".pdf-to-rag-examples-smoke";
const cli = join(root, "dist/cli.js");

function findSmallestPdf() {
  let names;
  try {
    names = readdirSync(examplesDir);
  } catch {
    throw new Error(`Missing ${examplesDir}`);
  }
  const pdfs = names.filter((n) => n.endsWith(".pdf") && !n.startsWith("."));
  if (pdfs.length === 0) {
    throw new Error(
      `No .pdf files in ${examplesDir}. Add PDFs under examples/ (see examples/README.md).`
    );
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
  return { name: bestName, path: join(examplesDir, bestName), size: bestSize };
}

const { name, path: pdfPath } = findSmallestPdf();
const tmp = mkdtempSync(join(tmpdir(), "pdf-to-rag-examples-smoke-"));

try {
  copyFileSync(pdfPath, join(tmp, name));

  const ingest = spawnSync(process.execPath, [cli, "ingest", tmp, "--store-dir", storeDirRel], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (ingest.status !== 0) {
    console.error(ingest.stderr || ingest.stdout);
    process.exit(ingest.status ?? 1);
  }

  const nlQuestion =
    "What is this document about in terms of neuroscience and the brain for students?";
  const query = spawnSync(
    process.execPath,
    [cli, "query", nlQuestion, "--store-dir", storeDirRel, "--top-k", "2"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (query.status !== 0) {
    console.error(query.stderr || query.stdout);
    process.exit(query.status ?? 1);
  }
  const out = query.stdout;
  if (
    !out.includes("Returned ") ||
    !out.includes("passage") ||
    !out.includes("topK=2") ||
    !out.includes("page") ||
    !out.includes("score=")
  ) {
    console.error("Unexpected query output (expected summary + citations):\n", out);
    process.exit(1);
  }

  console.log(`examples:smoke ok (ingested smallest PDF: ${name}, NL query smoke)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
