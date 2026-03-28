#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { PdfToRagConfig } from "../config/defaults.js";
import { defaultConfig } from "../config/index.js";
import { createNoOpHooks } from "../hooks/index.js";
import { createAppDeps, runIngest, runInspect, runQuery } from "../application/index.js";
import { loadPathPolicy, assertPathAllowed, resolveUnderWorkspace } from "./paths.js";
import {
  toolSuccess,
  toolFailure,
  mapUnknownError,
  type McpToolResult,
} from "./tool-results.js";
import { readPackageVersion } from "./version.js";

function asCallResult(payload: McpToolResult<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export function createPdfToRagMcpServer(): McpServer {
  const version = readPackageVersion();
  const policy = loadPathPolicy();

  const server = new McpServer(
    { name: "pdf-to-rag", version },
    { instructions: "Local PDF ingest and semantic query with file/page citations. See docs/use/mcp.md for env and security." }
  );

  server.registerTool(
    "ingest",
    {
      description:
        "Full reindex: scan a directory for PDFs, chunk, embed locally, and write the vector index under storeDir. Omit path to use PDF_TO_RAG_SOURCE_DIR.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Directory containing PDFs (absolute or relative to PDF_TO_RAG_CWD). Omit if PDF_TO_RAG_SOURCE_DIR is set."),
        storeDir: z.string().optional().describe("Index directory name/path segment (default .pdf-to-rag)"),
        chunkSize: z.number().int().positive().optional(),
        overlap: z.number().int().nonnegative().optional(),
        recursive: z.boolean().optional().describe("Scan subdirectories (default true)"),
      },
    },
    async (args) => {
      try {
        const pathArg = typeof args.path === "string" ? args.path.trim() : "";
        const rawPath = pathArg.length > 0 ? pathArg : policy.defaultSourceDir;
        if (!rawPath) {
          return asCallResult(
            toolFailure(
              "INVALID_INPUT",
              "ingest requires `path` or environment variable PDF_TO_RAG_SOURCE_DIR"
            )
          );
        }

        const resolvedPath = resolveUnderWorkspace(policy.workspaceCwd, rawPath);
        assertPathAllowed(resolvedPath, policy);

        const overrides: Partial<PdfToRagConfig> = {};
        if (args.storeDir !== undefined) overrides.storeDir = args.storeDir;
        if (args.chunkSize !== undefined) overrides.chunkSize = args.chunkSize;
        if (args.overlap !== undefined) overrides.chunkOverlap = args.overlap;
        if (args.recursive === false) overrides.recursive = false;

        const config = defaultConfig(overrides);
        const storeBase = resolveUnderWorkspace(policy.workspaceCwd, config.storeDir);
        assertPathAllowed(storeBase, policy);

        const deps = await createAppDeps(policy.workspaceCwd, config);
        const result = await runIngest(resolvedPath, policy.workspaceCwd, deps, createNoOpHooks());
        return asCallResult(toolSuccess(result));
      } catch (e) {
        const err = mapUnknownError(e);
        if (!err.ok && err.error.code === "PATH_NOT_ALLOWED") {
          return asCallResult(err);
        }
        const message = !err.ok ? err.error.message : String(e);
        return asCallResult(toolFailure("INGEST_FAILED", message));
      }
    }
  );

  server.registerTool(
    "query",
    {
      description:
        "Semantic search over the local index from a natural-language question (embedding similarity, not keyword-only). Returns ranked verbatim chunks with fileName and page citations; match count is data.hits.length (≤ topK).",
      inputSchema: {
        question: z
          .string()
          .min(1)
          .describe("Natural-language question or phrase to embed and match against chunks."),
        topK: z.number().int().positive().optional(),
        storeDir: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const overrides: Partial<PdfToRagConfig> = {};
        if (args.storeDir !== undefined) overrides.storeDir = args.storeDir;
        if (args.topK !== undefined) overrides.topK = args.topK;

        const config = defaultConfig(overrides);
        const storeBase = resolveUnderWorkspace(policy.workspaceCwd, config.storeDir);
        assertPathAllowed(storeBase, policy);

        const deps = await createAppDeps(policy.workspaceCwd, config);
        const hits = await runQuery(args.question, deps, createNoOpHooks());
        return asCallResult(toolSuccess({ hits }));
      } catch (e) {
        const err = mapUnknownError(e);
        if (!err.ok && err.error.code === "PATH_NOT_ALLOWED") {
          return asCallResult(err);
        }
        const message = !err.ok ? err.error.message : String(e);
        return asCallResult(toolFailure("QUERY_FAILED", message));
      }
    }
  );

  server.registerTool(
    "inspect",
    {
      description: "Index stats (chunk count, source files) without loading the embedding model.",
      inputSchema: {
        storeDir: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const overrides: Partial<PdfToRagConfig> = {};
        if (args.storeDir !== undefined) overrides.storeDir = args.storeDir;

        const config = defaultConfig(overrides);
        const storeBase = resolveUnderWorkspace(policy.workspaceCwd, config.storeDir);
        assertPathAllowed(storeBase, policy);

        const result = await runInspect(policy.workspaceCwd, config);
        return asCallResult(toolSuccess(result));
      } catch (e) {
        const err = mapUnknownError(e);
        if (!err.ok && err.error.code === "PATH_NOT_ALLOWED") {
          return asCallResult(err);
        }
        const message = !err.ok ? err.error.message : String(e);
        return asCallResult(toolFailure("INSPECT_FAILED", message));
      }
    }
  );

  return server;
}

async function main(): Promise<void> {
  const mcp = createPdfToRagMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
