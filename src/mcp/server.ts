#!/usr/bin/env node
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { PdfToRagConfig } from "../config/defaults.js";
import { defaultConfig } from "../config/index.js";
import { createNoOpHooks } from "../hooks/index.js";
import {
  createAppEmbedder,
  resolveEmbeddingModelId,
  runIngest,
  runInspect,
  runQuery,
} from "../application/index.js";
import type { AppDeps } from "../application/index.js";
import type { IngestResult } from "../domain/results.js";
import type { Embedder } from "../embeddings.js";
import { FileVectorStore } from "../storage/file-store.js";
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

// ---------------------------------------------------------------------------
// Embedder singleton — the ONNX model is expensive to load; keep it in memory
// for the lifetime of the MCP server process rather than re-creating it on
// every tool call.
// ---------------------------------------------------------------------------
let _embedderPromise: Promise<Embedder> | null = null;

function getSharedEmbedder(config: PdfToRagConfig): Promise<Embedder> {
  if (!_embedderPromise) _embedderPromise = createAppEmbedder(config);
  return _embedderPromise;
}

/** Build AppDeps reusing the cached embedder; creates a fresh store per call. */
async function buildDeps(cwd: string, config: PdfToRagConfig): Promise<AppDeps> {
  const embedder = await getSharedEmbedder(config);
  const modelId = resolveEmbeddingModelId(config);
  const indexPath = join(resolve(cwd), config.storeDir, config.indexFileName);
  const store = new FileVectorStore(indexPath, modelId);
  return { config: { ...config, embeddingModel: modelId }, embedder, store };
}

// ---------------------------------------------------------------------------

export function createPdfToRagMcpServer(): McpServer {
  const version = readPackageVersion();
  const policy = loadPathPolicy();

  const server = new McpServer(
    { name: "pdf-to-rag", version },
    { instructions: "Local PDF ingest and semantic query with file/page citations. See docs/use/mcp.md for env and security." }
  );

  // ── ingest ────────────────────────────────────────────────────────────────
  server.registerTool(
    "ingest",
    {
      description:
        "Scan a directory for PDFs, chunk, embed locally, and update the vector index under storeDir (unchanged files skipped via mtime+size). Omit path to use PDF_TO_RAG_SOURCE_DIR.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Directory containing PDFs (absolute or relative to PDF_TO_RAG_CWD). Omit if PDF_TO_RAG_SOURCE_DIR is set."),
        storeDir: z.string().optional().describe("Index directory name/path segment (default .pdf-to-rag)"),
        chunkSize: z.number().int().positive().optional(),
        overlap: z.number().int().nonnegative().optional(),
        recursive: z.boolean().optional().describe("Scan subdirectories (default true)"),
        stripMargins: z.boolean().optional().describe("Strip page headers and footers before chunking (default true)"),
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
        if (args.stripMargins === false) overrides.stripMargins = false;

        const config = defaultConfig(overrides);
        const storeBase = resolveUnderWorkspace(policy.workspaceCwd, config.storeDir);
        assertPathAllowed(storeBase, policy);

        const deps = await buildDeps(policy.workspaceCwd, config);
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

  // ── query ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "query",
    {
      description:
        "Semantic search over the local index from a natural-language question (embedding similarity, not keyword-only). Returns ranked verbatim chunks with fileName and page citations; match count is data.hits.length (≤ topK). If the index is empty, data.warning explains how to fix it.",
      inputSchema: {
        question: z
          .string()
          .min(1)
          .describe("Natural-language question or phrase to embed and match against chunks."),
        hypotheticalAnswer: z
          .string()
          .optional()
          .describe("HyDE (F15): a hypothetical answer to the question generated by an LLM. When provided, it is embedded as a passage in place of the question, closing the query-to-passage alignment gap for short or abstract queries. The calling model generates this; pdf-to-rag does not produce it."),
        topK: z.number().int().positive().optional(),
        minScore: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Minimum cosine similarity score (0–1). Chunks below this threshold are excluded. Recommended: 0.3 to filter low-relevance results."),
        mmr: z.boolean().optional().describe("Apply Maximal Marginal Relevance reranking for result diversity (default false)."),
        mmrLambda: z.number().min(0).max(1).optional().describe("MMR trade-off: 1 = pure relevance, 0 = pure diversity (default 0.5)."),
        storeDir: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const overrides: Partial<PdfToRagConfig> = {};
        if (args.storeDir !== undefined) overrides.storeDir = args.storeDir;
        if (args.topK !== undefined) overrides.topK = args.topK;
        if (args.mmr !== undefined) overrides.mmr = args.mmr;
        if (args.mmrLambda !== undefined) overrides.mmrLambda = args.mmrLambda;

        const config = defaultConfig(overrides);
        const storeBase = resolveUnderWorkspace(policy.workspaceCwd, config.storeDir);
        assertPathAllowed(storeBase, policy);

        const deps = await buildDeps(policy.workspaceCwd, config);
        const hits = await runQuery(args.question, deps, createNoOpHooks(), args.minScore, args.hypotheticalAnswer);

        const warning =
          deps.store.getChunkCount() === 0
            ? "Index is empty — run the ingest tool first (or use the search tool which auto-ingests from PDF_TO_RAG_SOURCE_DIR)."
            : undefined;

        return asCallResult(toolSuccess({ hits, ...(warning ? { warning } : {}) }));
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

  // ── search ────────────────────────────────────────────────────────────────
  server.registerTool(
    "search",
    {
      description:
        "Answer a natural-language question using the PDF corpus. If the index is empty, automatically ingests PDFs from sourceDir (or PDF_TO_RAG_SOURCE_DIR) before querying. Use this as the single tool for question-answering workflows — no manual ingest step required.",
      inputSchema: {
        question: z
          .string()
          .min(1)
          .describe("Natural-language question, e.g. 'What are the main cells in the brain?'"),
        sourceDir: z
          .string()
          .optional()
          .describe("PDF corpus directory to auto-ingest when the index is empty (absolute or relative to PDF_TO_RAG_CWD). Falls back to PDF_TO_RAG_SOURCE_DIR."),
        hypotheticalAnswer: z
          .string()
          .optional()
          .describe("HyDE (F15): a hypothetical answer to the question generated by an LLM. When provided, it is embedded as a passage in place of the question, closing the query-to-passage alignment gap for short or abstract queries. The calling model generates this; pdf-to-rag does not produce it."),
        topK: z.number().int().positive().optional(),
        minScore: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Minimum cosine similarity score (0–1). Recommended: 0.3 to filter low-relevance results."),
        mmr: z.boolean().optional().describe("Apply Maximal Marginal Relevance reranking for result diversity (default false)."),
        mmrLambda: z.number().min(0).max(1).optional().describe("MMR trade-off: 1 = pure relevance, 0 = pure diversity (default 0.5)."),
        storeDir: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const overrides: Partial<PdfToRagConfig> = {};
        if (args.storeDir !== undefined) overrides.storeDir = args.storeDir;
        if (args.topK !== undefined) overrides.topK = args.topK;
        if (args.mmr !== undefined) overrides.mmr = args.mmr;
        if (args.mmrLambda !== undefined) overrides.mmrLambda = args.mmrLambda;

        const config = defaultConfig(overrides);
        const storeBase = resolveUnderWorkspace(policy.workspaceCwd, config.storeDir);
        assertPathAllowed(storeBase, policy);

        const deps = await buildDeps(policy.workspaceCwd, config);

        await deps.store.load();
        let autoIngestResult: IngestResult | undefined;

        if (deps.store.getChunkCount() === 0) {
          const sourceDirArg =
            typeof args.sourceDir === "string" ? args.sourceDir.trim() : "";
          const rawSourcePath =
            sourceDirArg.length > 0 ? sourceDirArg : policy.defaultSourceDir;

          if (!rawSourcePath) {
            return asCallResult(
              toolFailure(
                "INVALID_INPUT",
                "Index is empty and no source directory is available for auto-ingest. " +
                  "Provide `sourceDir` or set PDF_TO_RAG_SOURCE_DIR, then retry."
              )
            );
          }

          const resolvedSource = resolveUnderWorkspace(policy.workspaceCwd, rawSourcePath);
          assertPathAllowed(resolvedSource, policy);

          autoIngestResult = await runIngest(
            resolvedSource,
            policy.workspaceCwd,
            deps,
            createNoOpHooks()
          );
        }

        const hits = await runQuery(args.question, deps, createNoOpHooks(), args.minScore, args.hypotheticalAnswer);

        return asCallResult(
          toolSuccess({
            hits,
            ...(autoIngestResult
              ? { autoIngested: true, ingest: autoIngestResult }
              : {}),
          })
        );
      } catch (e) {
        const err = mapUnknownError(e);
        if (!err.ok && err.error.code === "PATH_NOT_ALLOWED") {
          return asCallResult(err);
        }
        const message = !err.ok ? err.error.message : String(e);
        return asCallResult(toolFailure("SEARCH_FAILED", message));
      }
    }
  );

  // ── inspect ───────────────────────────────────────────────────────────────
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
