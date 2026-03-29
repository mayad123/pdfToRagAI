# Performance benchmarks (D7 / N3)

All numbers below are **one machine**, **one corpus**—use them as **relative** guidance, not guarantees. Re-run on your hardware before drawing strong conclusions.

## Recorded environment

| Field | Value |
|-------|-------|
| **Date** | 2026-03-29 |
| **Corpus** | `examples/` (2 PDFs, **3379** chunks, default chunking) |
| **Embedding** | Transformers.js default `Xenova/all-mpnet-base-v2` (CPU ONNX in Node) |
| **Node** | v25.x (see `node -v` on runner) |
| **HNSW** | Built when `chunkCount ≥ PDF_TO_RAG_HNSW_THRESHOLD` (default **2000**) at **ingest** time |

## Full ingest wall time (Transformers, CPU)

| Configuration | Wall time | Notes |
|---------------|-----------|--------|
| Default threshold (HNSW **on** for 3379 chunks) | **~162 s** | Includes PDF extract, chunk, embed, binary sidecar + HNSW build |
| `PDF_TO_RAG_HNSW_THRESHOLD=99999` (no HNSW file) | **~156 s** | Same vectors; skips native HNSW build |

Commands:

```bash
npm run build
time node dist/cli.js ingest ./examples --store-dir .pdf-to-rag-d8 --no-recursive
PDF_TO_RAG_HNSW_THRESHOLD=99999 time node dist/cli.js ingest ./examples --store-dir .pdf-to-rag-linear --no-recursive
```

**Ollama (GPU / Metal):** repeat with `PDF_TO_RAG_EMBED_BACKEND=ollama`, `OLLAMA_EMBED_MODEL=nomic-embed-text` (or your model), daemon running—expect much faster embedding for large corpora; record `ollama -v` and model id in this table when measured.

## Query latency (mean `searchQuery`, top-10)

Measured with a small Node loop after **warming** the embedder (2 runs discarded, then 5 or 10 timed runs). **Does not** include cross-encoder reranking.

| Index layout | Chunks | Mean latency |
|--------------|--------|--------------|
| **HNSW** (default threshold) | 3379 | **~4.4 ms** |
| **Linear** cosine (no HNSW built) | 3379 | **~7.9 ms** |

At this N, HNSW is already faster than full linear scan; the gap grows super-linearly as N increases.

## Corpus sizes 100 / 500 / 2000 / 5000 chunks

The shipped `examples/` corpus lands near **~3.4k** chunks. To benchmark arbitrary N:

1. **Smaller N:** ingest a **subset** of PDFs (or a single chapter PDF) until `node dist/cli.js inspect --store-dir …` reports the target range.
2. **N ≈ 5000:** add more PDFs, or duplicate corpus into a temp folder with renamed files (synthetic inflation—document that the content is duplicated).

Then repeat the ingest + `searchQuery` timing loop. Keep **embedding model** and **chunk size** fixed when comparing search implementations.

## Related docs

- [requirements § N3](../management/requirements.md#non-functional--security) — design targets vs measured evidence  
- [retrieval-quality.md](./retrieval-quality.md) — quality metrics on the same stack  
