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
 *
 * Static site: GET requests for files under public/ (e.g. /, /index.html,
 * /setup.html, /about.html, /demo.html, /styles.css) are served with path
 * traversal rejected. MCP remains at /mcp only.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPdfToRagMcpServer } from "./server.js";

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const publicRootResolved = resolve(publicRoot);

/** GET-only: resolve a path under public/; rejects traversal and non-files. */
function resolvePublicFile(pathOnly: string): string | null {
  const trimmed = (pathOnly.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const rel = trimmed === "/" ? "index.html" : trimmed.replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.includes("\\") || rel.includes("\0")) return null;
  if (!/^[a-zA-Z0-9._/-]+$/.test(rel)) return null;
  const candidate = resolve(join(publicRoot, rel));
  const prefix = publicRootResolved.endsWith(sep) ? publicRootResolved : publicRootResolved + sep;
  if (!candidate.startsWith(prefix)) return null;
  if (!existsSync(candidate)) return null;
  try {
    if (!statSync(candidate).isFile()) return null;
  } catch {
    return null;
  }
  return candidate;
}

function contentTypeFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

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

  if (req.method === "GET") {
    const filePath = resolvePublicFile(pathOnly);
    if (filePath) {
      res.writeHead(200, {
        "Content-Type": contentTypeFor(filePath),
        ...corsHtml,
      });
      res.end(readFileSync(filePath));
      return;
    }
  }

  if (pathOnly !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Not found. Static pages: GET /, /setup.html, /about.html, /demo.html; MCP Streamable HTTP at POST/GET /mcp."
    );
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
