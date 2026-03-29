---
name: pdf-rag-security
description: >-
  pdf-to-rag: security review for MCP path allowlists, dependency risk, and safe documentation examples.
  Use when adding filesystem inputs, env vars, dependencies, or MCP host config guidance.
---

# pdf-rag security review workflow

## Scope

- `src/mcp/paths.ts` — allowlist behavior
- `src/mcp/server-http.ts` — static file resolution under `public/` (traversal rejection, regular files only, resolved path prefix under `publicRoot`); default bind host (`127.0.0.1`) and guidance not to expose wide without TLS/auth
- `docs/use/mcp.md` — user-facing security and env guidance
- `package.json` dependencies — notable adds/upgrades (`@modelcontextprotocol/sdk`, `pdfjs-dist`, `@xenova/transformers`, `zod`, etc.)
- Any new code paths that read/write paths from user or tool input

## Assumptions

- MCP server runs as the **local user**; filesystem access is powerful.

## Checklist

1. Resolved **ingest** and **store** paths stay under configured roots (`PDF_TO_RAG_CWD`, `PDF_TO_RAG_ALLOWED_DIRS`, `PDF_TO_RAG_ROOT`).
2. Examples do not recommend overly broad `PDF_TO_RAG_ALLOWED_DIRS` or writing indexes to world-shared dirs without warning.
3. No secrets, tokens, or unsafe “curl | sh” patterns in docs.
4. Align narrative with N1–N4 in `docs/management/requirements.md` where relevant (including **local Ollama**: operators must trust **`OLLAMA_HOST`**; chunk text is sent to that HTTP endpoint).
5. Static `GET` handlers cannot escape `public/` (no `..`, no directories served as files, no sensitive paths under repo root).

## Output format

- **Must fix** vs **should fix**, with file/section pointers.
- Prefer doc updates + code fixes over vague warnings.
