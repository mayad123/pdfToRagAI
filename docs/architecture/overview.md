# Architecture overview

How **pdf-to-rag** is structured in `src/`: entry points, application layer, pipeline, and storage. CLI, library consumers, and the MCP server all call the same **application API**.

## Layered model

```mermaid
flowchart TB
  subgraph surfaces [Surfaces]
    CLI["CLI dist/cli.js"]
    MCP["MCP dist/mcp/server.js"]
    LIB["Library dist/index.js"]
  end
  subgraph app [Application]
    FACTORY[factory.ts createAppDeps]
    ING[ingest.ts runIngest]
    QRY[query.ts runQuery]
    INS[inspect.ts runInspect]
  end
  subgraph pipeline [Pipeline and I/O]
    PDF[pdf/]
    NORM[normalization/]
    CHUNK[chunking/]
    META[metadata/]
    INGP[ingestion/pipeline.ts]
    EMB[embeddings.ts]
    STO[storage/]
    SRCH[query/search.ts]
  end
  subgraph support [Shared]
    CFG[config/]
    DOM[domain/]
    HK[hooks/]
    UT[utils/]
  end
  CLI --> ING
  CLI --> QRY
  CLI --> INS
  MCP --> ING
  MCP --> QRY
  MCP --> INS
  LIB --> FACTORY
  LIB --> ING
  LIB --> QRY
  LIB --> INS
  ING --> INGP
  QRY --> SRCH
  INS --> STO
  INGP --> PDF
  INGP --> NORM
  INGP --> CHUNK
  CHUNK --> META
  INGP --> EMB
  INGP --> STO
  SRCH --> EMB
  SRCH --> STO
  FACTORY --> EMB
  FACTORY --> STO
  FACTORY --> CFG
```

**Rules of thumb**

- **`src/commands/`** — Commander wiring and stdout only; calls `runIngest` / `runQuery` / `runInspect`.
- **`src/mcp/`** — stdio MCP server, Zod-shaped tool I/O, path policy (`paths.ts`), result envelope (`tool-results.ts`); calls the same `run*` functions.
- **`src/application/`** — Orchestration, `AppDeps`, hooks around ingest/query.
- **`src/domain/`** — Types only (documents, chunks, results); no I/O.
- **`src/ingestion/pipeline.ts`** — Core ingest stages: PDF → text → chunks → embed → `VectorStore.replaceAll`.

## Source tree (by responsibility)

| Path | Role |
|------|------|
| `cli.ts` | CLI entry; registers `ingest`, `query`, `inspect` commands. |
| `commands/` | `ingest.ts`, `query.ts`, `inspect.ts` — parse args, print results. |
| `application/` | `createAppDeps`, `runIngest`, `runQuery`, `runInspect`, `deps.ts`, `factory.ts` (selects Transformers vs Ollama from **`PDF_TO_RAG_EMBED_BACKEND`**, merges effective `embeddingModel` into config for Ollama). |
| `mcp/` | `server.ts`, `paths.ts`, `tool-results.ts`, `version.ts`. |
| `config/` | Defaults and `PdfToRagConfig` (`defaults.ts`). |
| `domain/` | `document`, `page`, `chunk`, `metadata`, `results` types. |
| `hooks/` | `Hooks` and lifecycle payloads for library users. |
| `pdf/` | `list.ts` (discover PDFs), `extract.ts` (page text via pdfjs). |
| `normalization/` | `clean.ts` — page text cleanup before chunking. |
| `chunking/` | `chunk.ts` — overlapping character windows + `attachMetadata`. |
| `metadata/` | `attach.ts` — deterministic chunk ids and file/page metadata. |
| `ingestion/` | `pipeline.ts` — `runIngestPipeline`; `index.ts` re-exports. |
| `embeddings.ts` | Public barrel: `createEmbedder` (Transformers default), `createTransformersEmbedder`, `createOllamaEmbedder`, `Embedder` type. |
| `embedding/` | Implementations: `transformers.ts` (Transformers.js), `ollama.ts` (HTTP `/api/embed` batch + `/api/embeddings` fallback, L2-normalized vectors). |
| `storage/` | `FileVectorStore`, JSON index on disk, linear search; **`search`** validates query vs stored embedding dimension. |
| `query/` | `search.ts` — `normalizeQueryText`, `searchQuery` (load index, normalize NL question, embed, cosine top-k over chunks). |

```mermaid
flowchart LR
  subgraph discover [Discovery]
    L[list.ts]
  end
  subgraph extract [Extraction]
    E[extract.ts]
  end
  subgraph text [Text]
    CL[clean.ts]
    CH[chunk.ts]
    AT[attach.ts]
  end
  subgraph index [Index]
    P[pipeline.ts]
    EM[embeddings.ts]
    FS[file-store.ts]
  end
  L --> P
  E --> CL
  CL --> CH
  CH --> AT
  AT --> P
  P --> EM
  P --> FS
```

## Ingest data flow

```mermaid
sequenceDiagram
  participant S as Surface CLI or MCP
  participant R as runIngest
  participant L as listPdfFiles
  participant P as runIngestPipeline
  participant X as extractPages clean chunk
  participant M as embedder.embed
  participant V as VectorStore.replaceAll
  S->>R: rootPath cwd deps hooks
  R->>L: list PDFs under root
  R->>P: docs config embedder store
  loop each document and page
    P->>X: extract clean chunkPageText
  end
  P->>M: batch texts
  P->>V: indexed chunks
  R->>R: hooks afterChunking afterIndexing
  R-->>S: IngestResult
```

## Query data flow

```mermaid
sequenceDiagram
  participant S as Surface CLI or MCP
  participant R as runQuery
  participant Q as searchQuery
  participant V as VectorStore
  participant M as embedder.embedOne
  S->>R: question deps hooks
  R->>Q: question config embedder store
  Q->>V: load
  Q->>M: normalized NL question
  Q->>V: search vector topK
  V-->>Q: hits
  Q-->>R: QueryHit list
  R-->>S: citations fileName page text
```

## Inspect path

`runInspect` **does not** load the embedding model. It constructs `FileVectorStore` for the index path, `load()`s JSON only, and returns chunk count and source file list.

```mermaid
flowchart LR
  RI[runInspect] --> FVS[FileVectorStore]
  FVS --> JSON[index.json]
```

## Public API surface (`src/index.ts`)

The package root export re-exports domain types, config defaults, hooks, **`createAppDeps` / `runIngest` / `runQuery` / `runInspect`**, embedder and store types, and lower-level helpers (`runIngestPipeline`, `searchQuery`, PDF list/extract, etc.) for advanced use.

## Related docs

- Usage (CLI, library, MCP host config): [use/](../use/) and root [README.md](../../README.md).
- Requirements and roadmap: [management/](../management/).
- MCP operator quick start: [onboarding/mcp.md](../onboarding/mcp.md).
