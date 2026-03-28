# /pdf-embeddings

Act as **Library maintainer** for **pdf-to-rag** embedding backends. Read and follow `.cursor/skills/pdf-rag-pipeline/SKILL.md`, and treat these as authoritative for embed behavior:

- **`docs/management/requirements.md`** — **F7** (env, `ollama:<model>` index id, re-ingest, dimension check), **N1** / **N3** (local Ollama in scope, perf expectations).
- **`src/application/factory.ts`** — `PDF_TO_RAG_EMBED_BACKEND`, `OLLAMA_EMBED_MODEL`, `OLLAMA_HOST`.
- **`src/embedding/`** — `ollama.ts` (batched `/api/embed`, legacy `/api/embeddings`, L2 normalize), `transformers.ts`.
- **`src/embeddings.ts`** — public exports (`createEmbedder`, `createTransformersEmbedder`, `createOllamaEmbedder`).
- **`src/storage/file-store.ts`** — query vs index dimension guard.

Then address the user’s goal below.

**Context (paste goal, env, or error):**

