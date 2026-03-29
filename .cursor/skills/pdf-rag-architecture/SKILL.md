---
name: pdf-rag-architecture
description: >-
  pdf-to-rag: layer boundaries and where code belongs. Use when adding modules, refactoring structure,
  designing MCP tool schemas, or deciding config vs pipeline changes. Prevents orchestration leaking into MCP/CLI.
---

# pdf-rag architecture workflow

## Layers (state explicitly when advising)

1. **CLI** — `src/commands/`, `src/cli.ts`: argv and stdout only.
2. **MCP** — `src/mcp/`: `server.ts` (stdio, Zod tool schemas, path policy, structured results), `server-http.ts` (Streamable HTTP `/mcp`, safe static `GET` for `public/`), shared `paths.ts` / `tool-results.ts` / `version.ts`. **No** ingest/query pipeline logic in MCP handlers.
3. **Application** — `src/application/`: `runIngest`, `runQuery`, `runInspect`, hooks.
4. **Domain** — `src/domain/`: types only; no I/O; no imports from pdf/storage/mcp/cli.
5. **Pipeline** — `src/ingestion/`, `src/pdf/`, `src/normalization/`, `src/chunking/`, `src/metadata/`, `src/storage/`, `src/query/`, `src/embeddings.ts`, `src/embedding/`: single-purpose modules.

## Invariants

- MCP and CLI call the library/application API: `createAppDeps`, `runIngest`, `runQuery`, `runInspect`. Do not reimplement the pipeline inside `src/mcp/`.
- Prefer extending `defaultConfig` / `PdfToRagConfig` over ad-hoc globals.
- Preserve chunk metadata (file, page, id) end-to-end.
- TypeScript only, local-first, no required paid APIs; optional **local Ollama** for embeddings (see **F7** in `docs/management/requirements.md`).

## When behavior or public API changes

- Update or extend `docs/architecture/overview.md` § Source tree (or a short ADR under `docs/architecture/`) if the decision crosses layers—that table is the authoritative map of `src/mcp/` vs application vs pipeline.

## Optional

- Small **mermaid** diagram for data flow (no `style` / color directives).

## Deliverable

- Which files **should** change vs **must not** absorb new responsibilities.
- Prefer clarity over new abstractions.
