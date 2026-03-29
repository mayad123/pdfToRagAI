#!/usr/bin/env node
/**
 * HTTP/SSE MCP server entry point (F5 extension — Phase 5).
 *
 * Exposes the same tools as the stdio server (`pdf-to-rag-mcp`) over a
 * Streamable HTTP transport, suitable for MCP hosts that cannot use stdio
 * (e.g. remote deployments, web-based clients).
 *
 * Usage:
 *   pdf-to-rag-mcp-http [--port PORT] [--host HOST]
 *
 * Defaults:
 *   PORT  3000  (override: --port or PDF_TO_RAG_HTTP_PORT env var)
 *   HOST  127.0.0.1  (override: --host or PDF_TO_RAG_HTTP_HOST env var)
 *
 * Path policy (allowed dirs, workspace, source dir) is controlled by the
 * same PDF_TO_RAG_* environment variables as the stdio server.
 *
 * The server runs in stateless mode — no session ID is issued; every POST
 * to /mcp is a fresh request. For stateful sessions, set
 * PDF_TO_RAG_HTTP_STATEFUL=1 to enable session tracking.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPdfToRagMcpServer } from "./server.js";

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const port = parseInt(
  process.argv.find((a, i) => process.argv[i - 1] === "--port") ??
  process.env.PDF_TO_RAG_HTTP_PORT ??
  "3000",
  10
);

const host =
  process.argv.find((a, i) => process.argv[i - 1] === "--host") ??
  process.env.PDF_TO_RAG_HTTP_HOST ??
  "127.0.0.1";

const stateful = process.env.PDF_TO_RAG_HTTP_STATEFUL === "1";

// ---------------------------------------------------------------------------
// Session registry (stateful mode only)
// ---------------------------------------------------------------------------
const sessions = new Map<string, { server: ReturnType<typeof createPdfToRagMcpServer>; transport: StreamableHTTPServerTransport }>();

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const corsHtml = {
  "Access-Control-Allow-Origin": "*",
} as const;

const httpServer = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
    });
    res.end();
    return;
  }

  const pathOnly = (req.url ?? "/").split("?")[0] ?? "/";

  if (req.method === "GET" && (pathOnly === "/" || pathOnly === "/index.html")) {
    const htmlPath = join(publicRoot, "index.html");
    if (existsSync(htmlPath)) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        ...corsHtml,
      });
      res.end(readFileSync(htmlPath));
    } else {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", ...corsHtml });
      res.end("public/index.html is missing (clone the full repository).");
    }
    return;
  }

  if (pathOnly !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found. GET / for the web demo; MCP Streamable HTTP is at POST/GET /mcp.");
    return;
  }

  // From here: Streamable HTTP MCP only
  if (stateful) {
    await handleStateful(req, res);
  } else {
    await handleStateless(req, res);
  }
});

async function handleStateless(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcp = createPdfToRagMcpServer();
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
  transport.onclose = () => { mcp.close().catch(() => undefined); };
}

async function handleStateful(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "DELETE" && sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      await session.server.close().catch(() => undefined);
      sessions.delete(sessionId);
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  // New session
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  const mcp = createPdfToRagMcpServer();
  await mcp.connect(transport);

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
    mcp.close().catch(() => undefined);
  };

  await transport.handleRequest(req, res);

  if (transport.sessionId) {
    sessions.set(transport.sessionId, { server: mcp as ReturnType<typeof createPdfToRagMcpServer>, transport });
  }
}

httpServer.listen(port, host, () => {
  console.log(`pdf-to-rag MCP HTTP: demo UI http://${host}:${port}/  ·  MCP transport http://${host}:${port}/mcp`);
});

httpServer.on("error", (e) => {
  console.error("HTTP server error:", e);
  process.exit(1);
});
