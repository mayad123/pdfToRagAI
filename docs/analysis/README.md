# Analysis notes

Published **retrieval** and **performance** artifacts for Phase 7 (**D7**, **D8**).

| File | Purpose |
|------|---------|
| [retrieval-quality.md](./retrieval-quality.md) | Gold-set metrics, A/B notes (baseline vs MMR, chunk size, HyDE, rerank) |
| [benchmarks.md](./benchmarks.md) | Timings: Transformers vs Ollama, linear vs HNSW methodology |
| `eval-dataset-phase7-sample.json` | Small hand-curated dataset (4 items) for reproducible CI-scale checks |
| `eval-results-*.json` | Machine-generated reports from `npm run eval:run` |

For **corpus-scale** synthetic Q&A, use `npm run eval:generate` (requires Ollama) then `eval:run` / `eval:compare` per [project.md § Testing methodology](../management/project.md#testing-and-evaluation-methodology).
