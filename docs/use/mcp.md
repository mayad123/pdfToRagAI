# Model Context Protocol (MCP) server

The **`pdf-to-rag-mcp`** command exposes the same ingest, query, and inspect flows as the CLI through MCP **tools** over **stdio**. The server is a thin layer: it validates paths, builds `AppDeps` via `createAppDeps`, and calls `runIngest`, `runQuery`, or `runInspect` from the library (`src/mcp/server.ts` → `src/application/`).

**Quick start:** First-time setup, build verification, Cursor config, and suggested tool order — [onboarding/mcp.md](../onboarding/mcp.md).

## Corpus directory (your PDF folder)

MCP is meant to index a **directory of PDFs** you choose—the **corpus**—then answer questions with citations.

| Concept | Role |
|---------|------|
| **Corpus** | Folder containing `.pdf` files (e.g. `examples/`, or any absolute path). |
| **`ingest` `path`** | That folder, as absolute path or relative to **`PDF_TO_RAG_CWD`**. |
| **Index** | Written under **`PDF_TO_RAG_CWD`** in `storeDir` (default `.pdf-to-rag`). |
| **`PDF_TO_RAG_SOURCE_DIR`** | Optional. Absolute path to your default corpus: added to **allowed roots**, and used when **`ingest`** is called **without** `path`. |

If the corpus lies **under** `PDF_TO_RAG_CWD`, relative paths like `"examples"` work and you may not need `PDF_TO_RAG_ALLOWED_DIRS`. If it lies **outside** cwd, set **`PDF_TO_RAG_ALLOWED_DIRS`** and/or **`PDF_TO_RAG_SOURCE_DIR`** so the resolved ingest path passes the allowlist.

See [onboarding/mcp.md](../onboarding/mcp.md) for a Cursor `mcp.json` example using `examples/`.

## Install and run

From a built clone:

```bash
npm install
npm run build
```

Run the server (stdio; intended for MCP hosts, not interactive use):

```bash
npx pdf-to-rag-mcp
# or
node dist/mcp/server.js
```

Environment:

| Variable | Purpose |
|----------|---------|
| `PDF_TO_RAG_CWD` | Working directory for resolving relative paths and default store (default: `process.cwd()`). |
| `PDF_TO_RAG_ALLOWED_DIRS` | Comma-separated absolute directories. Ingest `path` (and the index `storeDir`) must lie inside an allowed root. If unset, only `PDF_TO_RAG_CWD` (or cwd) is allowed. |
| `PDF_TO_RAG_ROOT` | Single absolute directory treated as an extra allowed root (optional; combined with allowed dirs logic). |
| `PDF_TO_RAG_SOURCE_DIR` | Optional absolute path to your **default PDF corpus**. That directory is added to allowed roots. If set, **`ingest`** may omit `path` and will use this directory. |
| `TRANSFORMERS_CACHE` | Transformers.js model cache (see root README). |
| `PDF_TO_RAG_EMBED_BACKEND` | `transformers` (default) or **`ollama`** for local Ollama embeddings. |
| `OLLAMA_EMBED_MODEL` | Required when backend is `ollama` (e.g. `nomic-embed-text`). |
| `OLLAMA_HOST` | Ollama base URL (default `http://127.0.0.1:11434`). |
| `OLLAMA_EMBED_BATCH_SIZE` | Max strings per `/api/embed` request (default `128`). |
| `OLLAMA_EMBED_CONCURRENCY` | Parallel `/api/embeddings` calls when batch API is unavailable (default `8`). |

For **large corpora**, prefer **`PDF_TO_RAG_EMBED_BACKEND=ollama`** with a pulled embed model and Ollama using **GPU or Metal**; keep the same env for both **`ingest`** and **`query`**. Changing backend or model requires a full **re-ingest**.

## Tools

### `ingest`

Index all PDFs under a directory (full reindex). Same behavior as `pdf-to-rag ingest`.

**Input (JSON arguments):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | no | Directory to scan for `.pdf` files. If omitted, **`PDF_TO_RAG_SOURCE_DIR`** must be set (see Environment). |
| `storeDir` | string | no | Index directory relative to cwd (default `.pdf-to-rag`). |
| `chunkSize` | number | no | Max chunk length in characters. |
| `overlap` | number | no | Chunk overlap in characters. |
| `recursive` | boolean | no | Scan subdirectories (default `true`). |

**Success payload:** `ok: true`, `data` with `filesProcessed`, `pagesProcessed`, `chunksIndexed`, `storePath`.

### `query`

Semantic search over the index (embedding similarity over chunks). Accepts full **natural-language questions** (e.g. long questions about chemicals, the brain, policies—not keywords only).

**Input:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question` | string | yes | Natural language question or phrase. |
| `topK` | number | no | Maximum number of hits to return (default from config). |
| `storeDir` | string | no | Index directory (default `.pdf-to-rag`). |

**Success payload:** `ok: true`, `data.hits[]` with `text`, `fileName`, `page`, `score`, `chunkId`. The **number of matches** in this response is **`data.hits.length`** (≤ `topK`). Each `text` is a **verbatim** excerpt suitable for **quotation** with `fileName` / `page`; there is no single synthesized “answer” field—clients compose answers from these hits if needed ([requirements § F9](../management/requirements.md#functional-traceability)).

### `inspect`

Index statistics without loading the embedding model.

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `storeDir` | string | no |

**Success payload:** `ok: true`, `data` with `storePath`, `chunkCount`, `files[]`.

### Error shape

On validation or runtime errors, tools return structured content with `ok: false`:

```json
{
  "ok": false,
  "version": "0.1.0",
  "error": {
    "code": "PATH_NOT_ALLOWED",
    "message": "human-readable message"
  }
}
```

| Code | When |
|------|------|
| `PATH_NOT_ALLOWED` | Resolved ingest or store path is outside configured allowed roots. Often fix by adding your corpus to **`PDF_TO_RAG_ALLOWED_DIRS`** or setting **`PDF_TO_RAG_SOURCE_DIR`**, or use a path under **`PDF_TO_RAG_CWD`**. |
| `INVALID_INPUT` | Missing or invalid arguments (e.g. **`ingest`** with no `path` and no **`PDF_TO_RAG_SOURCE_DIR`**). |
| `INGEST_FAILED` | Ingest pipeline or embedding failed after path checks. |
| `QUERY_FAILED` | Query or embedding failed after path checks. |
| `INSPECT_FAILED` | Could not read or parse the index. |
| `INTERNAL` | Unexpected error surfaced by the error mapper (rare in tools; prefer the specific codes above). |

Successful payloads always include `ok: true`, `version`, and `data` in `structuredContent` (and JSON text in `content`). The server does not register an MCP output schema validator (Zod 4 unions are not compatible with the current SDK normalizer); clients should parse `structuredContent` as JSON.

## Client configuration

### Cursor

Add an MCP server entry (Settings → MCP) pointing at your Node binary and the built server, for example:

```json
{
  "mcpServers": {
    "pdf-to-rag": {
      "command": "node",
      "args": ["/absolute/path/to/pdfToRag/dist/mcp/server.js"],
      "env": {
        "PDF_TO_RAG_CWD": "/absolute/path/to/your/project",
        "PDF_TO_RAG_SOURCE_DIR": "/absolute/path/to/your/project/examples",
        "PDF_TO_RAG_ALLOWED_DIRS": "/absolute/path/to/your/project/examples"
      }
    }
  }
}
```

Adjust paths for your machine. If the corpus folder is already under `PDF_TO_RAG_CWD`, you can omit `ALLOW_DIRS` / `SOURCE_DIR` when you always pass `path` on **`ingest`**. Using `npx` is possible if the package is published or linked globally.

## Security

- **Allowlist:** Always set `PDF_TO_RAG_ALLOWED_DIRS` and/or `PDF_TO_RAG_SOURCE_DIR` (or restrict `PDF_TO_RAG_CWD`) when the MCP server can be reached by tools you do not fully trust. Ingest refuses paths outside allowed roots.
- **Local process:** The server runs as your user; it can read PDFs and write the index under `storeDir`. Do not point allowed dirs at sensitive system paths unless intended.
- **Default path:** no paid embedding APIs; Transformers.js may download models from Hugging Face on first use.
- **Ollama path:** chunk text is sent to **`OLLAMA_HOST`** over HTTP (usually localhost). Use a **trusted** base URL; do not point at an untrusted remote server.

## Verification (developers)

From a clean build:

```bash
npm run build
npm run mcp:smoke
```

This spawns `dist/mcp/server.js` over stdio and checks that `ingest`, `query`, and `inspect` are registered.

## Resource expectations

- **First ingest or query** in a process: **Transformers** loads the ONNX model (CPU-heavy). **Ollama** avoids that load but requires a running Ollama process and a pulled embed model.
- **Large PDF folders** can take many minutes on the default Transformers path; **Ollama + GPU/Metal** is recommended for large corpora. The MCP call blocks until completion.

## Troubleshooting

| Issue | Mitigation |
|-------|------------|
| First call is slow | Embedding model download; set `TRANSFORMERS_CACHE` to a persistent directory. |
| Smoke test fails to connect | Run `npm run build` so `dist/mcp/server.js` exists; ensure Node 18+. |
| PDF text empty / weird | Source PDF may be scanned images; this stack is text-extraction only. |
| Ingest path not allowed / `PATH_NOT_ALLOWED` | Include your corpus in **`PDF_TO_RAG_ALLOWED_DIRS`**, set **`PDF_TO_RAG_SOURCE_DIR`** to the corpus (also allowlists it), or use a directory under **`PDF_TO_RAG_CWD`**. |
| pdfjs worker errors | The library resolves `pdf.worker.mjs` from `pdfjs-dist`; use a supported Node (18+). |
| `Unable to load font data` / `FoxitSymbol.pfb` with spaces in repo path | Fixed in current `src/pdf/extract.ts` by passing filesystem paths for `standardFontDataUrl` / `cMapUrl` (not `file://` URLs). Rebuild (`npm run build`). |
| Query fails / dimension mismatch | **Re-ingest** with the same embedding backend and model as you use for **`query`** (`PDF_TO_RAG_EMBED_BACKEND`, `OLLAMA_EMBED_MODEL`). |
| `INGEST_FAILED` with Ollama | Ensure Ollama is running, **`OLLAMA_EMBED_MODEL`** is set, and the model is pulled (`ollama pull …`). |
| MCP client shows stderr noise | The server should not write to stdout when connected; diagnostics belong on stderr only. |

## Version

The server reports the package `version` in MCP `serverInfo` and includes `version` in successful tool payloads where applicable.

## Code map

```mermaid
flowchart LR
  subgraph mcp [src/mcp]
    S[server.ts]
    P[paths.ts]
    T[tool-results.ts]
  end
  subgraph app [src/application]
    RI[runIngest]
    RQ[runQuery]
    RS[runInspect]
  end
  S --> P
  S --> RI
  S --> RQ
  S --> RS
```

See also [architecture/overview.md](../architecture/overview.md).
