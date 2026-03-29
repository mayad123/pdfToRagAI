# Example PDF corpus

Place **text-based** `.pdf` files in this directory when you want a local sample corpus (papers, docs, book excerpts, etc.). The repo may ship with files here or you may add your own.

## Quick check (smoke)

Do **not** rely on a full-folder ingest for a quick sanity check. Use the scripted smoke target, which ingests only the **smallest** PDF under `examples/` and runs a **natural-language** `query` (semantic search, not keyword-only):

```bash
npm run examples:smoke
```

## JSON fixtures (NL queries and expected quotations)

You can define **natural-language questions** and **verbatim substring** expectations (direct quotations that must appear in retrieved chunk text) in a JSON file, then run:

```bash
npm run build
cp examples/query-fixtures.sample.json examples/query-fixtures.json
# edit query-fixtures.json, then:
npm run examples:fixtures
# or: npm run examples:fixtures -- /absolute/or/relative/path/to/fixtures.json
```

**Behavior:** The script ingests the corpus (`corpus.mode`: **`smallest`** = one smallest PDF, **`all`** = every PDF in `corpus.sourceDir`), then for each **`cases[]`** entry runs semantic **`runQuery`** and checks **`expect`** against the returned **`QueryHit[]`** (same data the CLI/MCP surfaces as quoted passages).

**`expect` fields (all optional; combined with AND):**

| Field | Meaning |
|--------|--------|
| `minHits` / `maxHits` | Length of the hit list after retrieval. |
| `textContains` | Each string must appear in **some** hit’s `text` (verbatim substring). |
| `textContainsAllInOneHit` | All strings must appear in the **same** hit’s `text` (one chunk). |
| `fileName` | Some hit must have this exact `fileName`. |
| `fileNameIncludes` | Some hit’s `fileName` must include this substring. |
| `page` | Either a positive integer (exact page) or `{ "gte": n, "lte": m }`. |

Per-case optional: **`topK`** (override), **`caseInsensitive`: true** (substring checks only).

`examples/query-fixtures.json` is gitignored so you can keep local expectations; commit **`query-fixtures.sample.json`** as a template. Assertions are **substring-based** so small PDF text or chunk-boundary shifts still pass when the quoted phrase still appears in a top hit. If you change **embedding model or backend**, re-run and adjust substrings if ranking changes.

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

For corpora that exceed 2000 chunks, the index automatically builds an HNSW approximate nearest-neighbor index (`index.hnsw`) on ingest, and query switches to HNSW search. The threshold is configurable via `PDF_TO_RAG_HNSW_THRESHOLD`.

**Re-ingest** after switching embedding backend or model so the index `embeddingModel` id matches the embedder (see [requirements § F7](../docs/management/requirements.md#functional-traceability)).

## Benchmarking

To record timings for your machine, use e.g. `time node dist/cli.js ingest ./examples` with your chosen env. You can note hardware class (CPU, GPU/Metal, Ollama version) alongside results when sharing benchmarks.

Maintainer-recorded tables (methodology + **HNSW vs linear** query latency on a fixed corpus) live in [docs/analysis/benchmarks.md](../docs/analysis/benchmarks.md) (**D7** / **N3**).

## Scripted demo (research-style questions)

**Phase 7 (D9):** `examples/demo-papers.mjs` ingests the **smallest** PDF in this folder into a **temporary** store, runs **four** general research-style questions, and prints **formatted citations** (file, page, score, excerpt).

```bash
npm run build
npm run demo:papers
```

Requires at least one `.pdf` in `examples/`. Uses the same embedding backend as your environment (`PDF_TO_RAG_EMBED_BACKEND` / Ollama vars when set).
