---
name: pdf-rag-pipeline
description: >-
  pdf-to-rag: core RAG ingest/query pipeline. Use when changing PDF extraction, chunking, metadata,
  embeddings, storage, application hooks, or library exports—not MCP/CLI wiring.
---

# pdf-rag pipeline workflow

## Scope

`src/application/` (including **`factory.ts`** embedder selection), `src/ingestion/`, `src/pdf/`, `src/normalization/`, `src/chunking/`, `src/metadata/`, `src/storage/`, `src/query/`, `src/embeddings.ts`, `src/embedding/`, `src/config/`, `src/hooks/`, `src/domain/`, `src/utils/`, and public exports in `src/index.ts`.

## Pipeline order (do not skip or collapse)

```
files → pages → cleaned text → chunks → metadata → embeddings → storage
```

## Rules

- `src/domain/` has **no** I/O and **no** imports from infrastructure (pdf, storage, etc.).
- **No** CLI argument parsing or MCP tool definitions inside pipeline modules.
- Hooks (`beforeIngest`, `afterChunking`, `afterIndexing`, `beforeQuery`) live in `src/hooks/` and are invoked from `src/application/` only.
- Preserve metadata through ingest and query: **file name**, **page**, **chunk id** (deterministic IDs via `src/utils/hash.ts` / `src/metadata/`).
- **Embeddings:** same `Embedder` interface everywhere; **Ollama** uses batched `/api/embed` when available, L2-normalized vectors, env-tunable batch size and concurrency. Changing backend or model requires **re-ingest**; query path checks **vector dimension** against the index.

## Outputs

- Focused code changes; match existing types and style.
- Avoid drive-by refactors outside the user’s request.
