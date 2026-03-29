/**
 * Spawns the MCP server, connects via stdio, verifies tools, and checks ingest with default path via PDF_TO_RAG_SOURCE_DIR.
 * Phase 2: ingests the smallest examples/ PDF and calls query to validate the MCP JSON path (F8).
 * Run after: npm run build
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverJs = join(root, "dist", "mcp", "server.js");

// ── Phase 1: tool registration + empty-corpus ingest ─────────────────────────

const emptyCorpusDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-mcp-smoke-"));

const transport = new StdioClientTransport({
  command: "node",
  args: [serverJs],
  cwd: root,
  stderr: "pipe",
  env: {
    ...process.env,
    PDF_TO_RAG_CWD: root,
    PDF_TO_RAG_SOURCE_DIR: emptyCorpusDir,
  },
});

const client = new Client({ name: "pdf-to-rag-smoke", version: "0.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const need = ["ingest", "inspect", "query", "search"];
  const missing = need.filter((n) => !names.includes(n));
  if (missing.length) {
    console.error("mcp:smoke failed: missing tools:", missing.join(", "), "got:", names.join(", "));
    process.exit(1);
  }

  const ingestResult = await client.callTool({ name: "ingest", arguments: {} });
  const payload = ingestResult.structuredContent;
  if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true) {
    console.error("mcp:smoke failed: ingest with default PDF_TO_RAG_SOURCE_DIR:", ingestResult);
    process.exit(1);
  }

  console.log("mcp:smoke phase 1 ok:", names.join(", "), "+ ingest default path");
} finally {
  await client.close();
  rmSync(emptyCorpusDir, { recursive: true, force: true });
}

// ── Phase 2: ingest smallest examples/ PDF, then query via MCP ───────────────

function findSmallestPdf(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const pdfs = names.filter((n) => n.endsWith(".pdf") && !n.startsWith("."));
  if (!pdfs.length) return null;
  let best = pdfs[0];
  let bestSize = statSync(join(dir, best)).size;
  for (let i = 1; i < pdfs.length; i++) {
    const s = statSync(join(dir, pdfs[i])).size;
    if (s < bestSize) {
      bestSize = s;
      best = pdfs[i];
    }
  }
  return join(dir, best);
}

const smallestPdf = findSmallestPdf(join(root, "examples"));
if (!smallestPdf) {
  console.log("mcp:smoke phase 2 skipped: no PDFs found in examples/");
  process.exit(0);
}

const corpusDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-mcp-smoke-corpus-"));
const storeDir = mkdtempSync(join(tmpdir(), "pdf-to-rag-mcp-smoke-store-"));
copyFileSync(smallestPdf, join(corpusDir, basename(smallestPdf)));

const transport2 = new StdioClientTransport({
  command: "node",
  args: [serverJs],
  cwd: root,
  stderr: "pipe",
  env: {
    ...process.env,
    PDF_TO_RAG_CWD: root,
    PDF_TO_RAG_ALLOWED_DIRS: `${corpusDir},${storeDir}`,
  },
});

const client2 = new Client({ name: "pdf-to-rag-smoke-query", version: "0.0.0" }, { capabilities: {} });

try {
  await client2.connect(transport2);

  // Ingest the PDF into the temp store
  const ingestResult = await client2.callTool({
    name: "ingest",
    arguments: { path: corpusDir, storeDir },
  });
  const ingestPayload = ingestResult.structuredContent;
  if (!ingestPayload || typeof ingestPayload !== "object" || !("ok" in ingestPayload) || ingestPayload.ok !== true) {
    console.error("mcp:smoke phase 2 failed: ingest error:", ingestResult);
    process.exit(1);
  }

  // Query with a natural-language question; assert data.hits is an array
  const queryResult = await client2.callTool({
    name: "query",
    arguments: {
      question: "What is this document about in terms of neuroscience and the brain?",
      storeDir,
      topK: 2,
    },
  });
  const queryPayload = queryResult.structuredContent;
  if (!queryPayload || typeof queryPayload !== "object" || !("ok" in queryPayload) || queryPayload.ok !== true) {
    console.error("mcp:smoke phase 2 failed: query error:", queryResult);
    process.exit(1);
  }
  if (!Array.isArray(queryPayload.data?.hits)) {
    console.error("mcp:smoke phase 2 failed: data.hits is not an array:", queryPayload);
    process.exit(1);
  }

  console.log(
    `mcp:smoke phase 2 ok: query returned data.hits (length=${queryPayload.data.hits.length}) via MCP JSON path`
  );
} finally {
  await client2.close();
  rmSync(corpusDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
}
