---
name: pdf-rag-mcp
description: >-
  pdf-to-rag: MCP server layer. Use when changing @modelcontextprotocol/sdk wiring, stdio server,
  tool definitions, Zod schemas, path allowlist (PDF_TO_RAG_*), or structured tool errors.
  After edits, verify build and mcp:smoke.
---

# pdf-rag MCP workflow

## Read first

- `docs/use/mcp.md`
- `src/mcp/server.ts`
- `src/mcp/paths.ts`, `src/mcp/tool-results.ts`, `src/mcp/version.ts` when touching errors or allowlists

## Invariants

- Tool handlers are **thin wrappers**: `createAppDeps` + `runIngest` / `runQuery` / `runInspect`. Do **not** import `src/pdf/` or `src/ingestion/` for orchestration from MCP handlers.
- Structured tool payload shape:
  - Success: `ok: true`, `version`, `data`
  - Failure: `ok: false`, `version`, `error: { code, message }`
- Path safety: `loadPathPolicy()`, `assertPathAllowed()`, `resolveUnderWorkspace()` — see `paths.ts`.
- Stdio-first; align env vars with `docs/use/mcp.md` (including **`PDF_TO_RAG_EMBED_BACKEND`**, **`OLLAMA_*`** when documenting ingest/query). No new paid APIs.

## After code changes

- Run or recommend: `npm run build` and `npm run mcp:smoke`.

## If no specific task

- Summarize current MCP tools, inputs, and env vars from code + `docs/use/mcp.md`.
