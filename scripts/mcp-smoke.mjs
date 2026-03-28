/**
 * Spawns the MCP server, connects via stdio, verifies tools, and checks ingest with default path via PDF_TO_RAG_SOURCE_DIR.
 * Run after: npm run build
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverJs = join(root, "dist", "mcp", "server.js");

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
  const need = ["ingest", "inspect", "query"];
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

  console.log("mcp:smoke ok:", names.join(", "), "+ ingest default path");
} finally {
  await client.close();
  rmSync(emptyCorpusDir, { recursive: true, force: true });
}
