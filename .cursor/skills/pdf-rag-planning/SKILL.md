---
name: pdf-rag-planning
description: >-
  pdf-to-rag: roadmap and release planning. Use when slicing features, defining acceptance criteria,
  linking work to docs/management/requirements.md (F/N/D IDs), or assessing risks (model download, ingest time,
  MCP env). Do not use for low-level implementation unless the user asks.
---

# pdf-rag planning workflow

Repository: **pdf-to-rag** only. Obey passive rules in `.cursor/rules/pdf-to-rag.mdc` (layers, no pipeline collapse into CLI/MCP).

## Before proposing a plan

1. Read `docs/management/roadmap.md` and `docs/management/requirements.md`.
2. Note Phase 3 items (incremental reindex, SSE) are **deferred** unless the user explicitly wants them.

## Outputs

- Small milestones with **done when** checks.
- Reference requirement IDs (F1, N2, D1, etc.) when traceability helps.
- **Risks:** Node 18+, first-run embedding download (Transformers.js default), long ingest on CPU ONNX for large corpora, **Ollama** dependency and hardware (GPU/Metal vs CPU) when using the fast path, MCP path allowlist (`PDF_TO_RAG_CWD`, `PDF_TO_RAG_ALLOWED_DIRS`, `PDF_TO_RAG_ROOT`).
- End with a short **out of scope** list to limit creep.

## Constraints

- Do not implement code unless the user explicitly requests implementation.
