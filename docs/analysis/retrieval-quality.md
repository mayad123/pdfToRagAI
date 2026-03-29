# Retrieval quality case study (D8)

This note **publishes real numbers** from the shipped eval pipeline (`eval:run`, `eval:compare`) on a **defined** gold dataset and index. It is **not** a substitute for a full synthetic run over hundreds of questions—that requires **`npm run eval:generate`** and a local **Ollama** chat model (see commands below).

## Environment (reproducibility footer)

| Field | Value used for tables in this doc |
|-------|-----------------------------------|
| **Date** | 2026-03-29 |
| **Machine** | Maintainer laptop (see `benchmarks.md` for OS/CPU detail when present) |
| **Node** | 18+ |
| **Embedding model** | `Xenova/all-mpnet-base-v2` (Transformers.js default) |
| **Corpus** | `examples/` (2 PDFs, **3379** chunks after ingest) |
| **Store** | `.pdf-to-rag-d8` (gitignored—rebuild with commands below) |
| **Dataset** | [eval-dataset-phase7-sample.json](./eval-dataset-phase7-sample.json) (4 items, hand-curated questions) |

### Rebuild index and rerun eval

```bash
npm run build
rm -rf .pdf-to-rag-d8
node dist/cli.js ingest ./examples --store-dir .pdf-to-rag-d8 --no-recursive
npm run eval:run -- \
  --dataset docs/analysis/eval-dataset-phase7-sample.json \
  --store-dir .pdf-to-rag-d8 \
  --report docs/analysis/eval-results-baseline.json \
  --top-k 50
npm run eval:run -- \
  --dataset docs/analysis/eval-dataset-phase7-sample.json \
  --store-dir .pdf-to-rag-d8 \
  --report docs/analysis/eval-results-mmr.json \
  --top-k 50 --mmr --mmr-lambda 0.6
npm run eval:compare -- \
  docs/analysis/eval-results-baseline.json \
  docs/analysis/eval-results-mmr.json
```

## Baseline (raw cosine, no MMR, no cross-encoder)

| Metric | Value |
|--------|-------|
| **Hit@1** | 75.0% |
| **Hit@10** | 100.0% |
| **MRR** | 0.781 |
| **nDCG@10** | 0.829 |
| **Not found** (in top-50) | 0 / 4 |

**Interpretation:** On this tiny suite, cosine retrieval usually places the gold chunk at rank 1; one question (spike-train / conditional intensity) landed at **rank 8**—typical when phrasing does not match the chunk verbatim.

## MMR on vs off (`--mmr`, λ = 0.6)

| Metric | Baseline | MMR | Δ |
|--------|----------|-----|---|
| Hit@1 | 75.0% | 75.0% | 0 |
| Hit@10 | 100.0% | 75.0% | −25.0% |
| MRR | 0.781 | 0.755 | −0.026 |
| nDCG@10 | 0.829 | 0.750 | −0.079 |

**Verdict (`eval:compare`):** **REGRESSED** at this λ—the hard case moved from rank **8** to **47** because MMR traded relevance for diversity in the expanded candidate pool.

**Takeaway:** MMR is **not** free precision; tune `mmrLambda` and candidate pool per corpus, or keep MMR off when the goal is maximum Hit@K on gold chunks. This matches the product default (`mmr: false`).

## HyDE (hypothetical answer embedding)

Gold-set **`eval:run` always embeds the question** with the `"query"` role. **HyDE** (`hypotheticalAnswer` on MCP / `searchQuery`) is **not** simulated here.

**Suggested follow-up:** Pick 10–20 hard cases, have your chat model write a one-sentence hypothetical answer, call **`query`** / **`search`** with `hypotheticalAnswer`, and compare ranks to the baseline—record in a new subsection or report file.

## Chunk size sensitivity (500 / 1000 / 1500 characters)

Requires **three separate ingests** (`--chunk-size`) into isolated `--store-dir` folders, then re-run **`eval:generate`** (or reuse question list) and **`eval:run`**. Not executed in this snapshot—see [roadmap § Phase 7 playbook](../management/roadmap.md#phase-7-implementation-playbook).

## Cross-encoder reranking

When **`PDF_TO_RAG_RERANK_MODEL`** is set, `eval:run` uses the **`searchQuery`** path (same as production) so cross-encoder reranking is included. Run:

```bash
export PDF_TO_RAG_RERANK_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
npm run eval:run -- --dataset docs/analysis/eval-dataset-phase7-sample.json \
  --store-dir .pdf-to-rag-d8 --report docs/analysis/eval-results-rerank.json
```

First run downloads the reranker weights (~80–100 MB). Compare to baseline with `eval:compare`.

## Full-corpus synthetic eval (recommended next step)

```bash
ollama pull llama3.2   # or set OLLAMA_CHAT_MODEL
npm run eval:generate -- --store-dir .pdf-to-rag-d8 --sample 200 --concurrency 4
npm run eval:run -- --report eval-results-full.json
```

This scales Hit@K / MRR / nDCG to hundreds of items and is the primary **portfolio** signal alongside this curated smoke set.
