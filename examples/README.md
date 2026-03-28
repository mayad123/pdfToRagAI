# Example PDF corpus

Place **text-based** `.pdf` files in this directory when you want a local sample corpus (papers, docs, book excerpts, etc.). The repo may ship with files here or you may add your own.

## Quick check (smoke)

Do **not** rely on a full-folder ingest for a quick sanity check. Use the scripted smoke target, which ingests only the **smallest** PDF under `examples/` and runs a **natural-language** `query` (semantic search, not keyword-only):

```bash
npm run examples:smoke
```

## JSON fixtures (NL queries and expected quotations)

Canonical file: **`examples/query-fixtures.json`**. Define **natural-language questions** and **verbatim substring** expectations, then run:

```bash
npm run build
npm run examples:fixtures
# optional path or verbose:
npm run examples:fixtures -- ./examples/query-fixtures.json --verbose
```

**Ranking vs `defaults.topK`:** The runner ingests your corpus, embeds each case’s question, **ranks every chunk** by cosine similarity, and builds a hit list of length **chunk count**. Assertions (`textContains`, `minHits`, …) use that **full ranked list**. The **`topK`** field in JSON still configures `PdfToRagConfig` (e.g. for consistency with other tooling); it does **not** truncate which chunks are checked for substrings. CLI/MCP **`query`** with the same config still returns only **`topK`** hits—fixtures are intentionally stricter on corpus coverage.

**Corpus**

| Field | Meaning |
|--------|--------|
| `mode` | **`smallest`** (default): one smallest PDF. **`all`**: every `.pdf` in `sourceDir`. |
| `sourceDir` | Relative to repo root (default `examples`). |
| `pinnedFiles` | Optional: only these PDF **basenames** are ingested (subset of `sourceDir`). |

**`expect` fields (all optional; combined with AND):**

| Field | Meaning |
|--------|--------|
| `minHits` / `maxHits` | Length of the hit list (after ingest, this is typically **all chunks**). |
| `minDistinctFiles` | At least this many unique `fileName` values among hits. |
| `textContains` | Each string appears in **some** chunk text in the **ranked** full list (substring). |
| `textContainsInCorpus` | Each string appears in **some** indexed chunk (same as scanning raw index text; use for ingest-only checks). |
| `textContainsAllInOneHit` | All strings appear in the **same** chunk’s `text`. |
| `relaxApostrophes` | **`false`** disables apostrophe normalization. **Default in the runner is on** (`'` vs `’` etc.) unless you set **`false`**. |
| `fileName` / `fileNameIncludes` / `page` | Match metadata on hits. |

Per-case optional: **`topK`** (config override only). **`caseInsensitive`** on the case or in **`expect`**.

Assertions are **substring-based**. A case fails if the quoted text is missing from the PDFs you ingested or the embedding backend differs from what you expect (**F7**).

## Full-folder ingest (heavy)

Indexing **every** PDF here can take a long time when the folder contains many large files: chunk count scales with pages, and **default Transformers.js** embeddings are CPU-oriented in Node—on the order of **~30 minutes** (or more) for a very large multi-PDF tree is plausible.

**Recommended for large `examples/` trees:** run [Ollama](https://ollama.com), `ollama pull nomic-embed-text` (or another embedding model Ollama supports), then:

```bash
export PDF_TO_RAG_EMBED_BACKEND=ollama
export OLLAMA_EMBED_MODEL=nomic-embed-text
# optional: OLLAMA_HOST, OLLAMA_EMBED_BATCH_SIZE, OLLAMA_EMBED_CONCURRENCY
npm run build
node dist/cli.js ingest ./examples
```

With Ollama using **GPU or Apple Metal**, full ingest of an `examples/`-scale corpus is a **design target** of **~5 minutes** wall time (not guaranteed on CPU-only Ollama). Tune batch size and concurrency if needed.

**Re-ingest** after switching embedding backend or model so the index `embeddingModel` id matches the embedder (see [requirements § F7](../docs/management/requirements.md#functional-traceability)).

## Benchmarking

To record timings for your machine, use e.g. `time node dist/cli.js ingest ./examples` with your chosen env. You can note hardware class (CPU, GPU/Metal, Ollama version) alongside results when sharing benchmarks.
