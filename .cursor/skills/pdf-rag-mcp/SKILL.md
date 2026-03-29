---
name: pdf-rag-mcp
description: >-
  pdf-to-rag: MCP server layer. Use when changing @modelcontextprotocol/sdk wiring, stdio or HTTP
  server, tool definitions, Zod schemas, path allowlist (PDF_TO_RAG_*), static public/ serving, or
  structured tool errors. After edits, verify build and mcp:smoke.
---

# pdf-rag MCP workflow

## Read first

- `docs/use/mcp.md`
- `src/mcp/server.ts` (stdio tools)
- `src/mcp/server-http.ts` when changing HTTP transport, `/mcp`, or static files under `public/`
- `src/mcp/paths.ts`, `src/mcp/tool-results.ts`, `src/mcp/version.ts` when touching errors or allowlists

## Invariants

- **Four tools** (`ingest`, `query`, `inspect`, `search`): handlers are **thin wrappers** around `createAppDeps` + `runIngest` / `runQuery` / `runInspect` (and `search`’s auto-ingest path uses the same). Do **not** import `src/pdf/` or `src/ingestion/` for orchestration from MCP handlers.
- Structured tool payload shape:
  - Success: `ok: true`, `version`, `data`
  - Failure: `ok: false`, `version`, `error: { code, message }`
- Path safety: `loadPathPolicy()`, `assertPathAllowed()`, `resolveUnderWorkspace()` — see `paths.ts`.
- **Transports:** **stdio** (`pdf-to-rag-mcp`) is the default for local MCP hosts (Cursor, etc.). **HTTP** (`pdf-to-rag-mcp-http`, `npm run mcp:http`) serves Streamable MCP on `/mcp` and static pages under `public/` for browsers (`StreamableHTTPClientTransport`). Static routes must stay **read-only** and **path-safe** (no traversal). Align env vars with `docs/use/mcp.md` (including **`PDF_TO_RAG_EMBED_BACKEND`**, **`OLLAMA_*`**). No new paid APIs.

## After code changes

- Run or recommend: `npm run build` and `npm run mcp:smoke`.
- After HTTP or static route changes: spot-check `GET /`, `/demo.html`, `/styles.css` (see `docs/use/mcp.md` § Web demo UI).

## If no specific task

- Summarize current MCP tools, inputs, and env vars from code + `docs/use/mcp.md`.
