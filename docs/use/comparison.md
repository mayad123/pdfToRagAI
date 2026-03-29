# pdf-to-rag vs common stacks

**Last updated:** 2026-03-28 (verify upstream docs and versions before relying on this table in production).

This is a **practical positioning** doc for operators and contributors—not a benchmark of retrieval quality. Upstream projects move quickly; follow the links and confirm behavior on your version.

| Dimension | **pdf-to-rag** | **LangChain** | **LlamaIndex** | **Unstructured** |
|-----------|----------------|---------------|----------------|------------------|
| **Primary focus** | Local PDF → chunks → embeddings → JSON vector store; CLI, library, MCP | Chains, agents, many vector stores and loaders | Data frameworks for LLM apps, indices, query engines | ETL: partition and extract structure from documents |
| **Paid cloud APIs** | Not required (Transformers.js / optional local Ollama HTTP) | Optional; many integrations are cloud | Optional; many integrations are cloud | Optional; SaaS and API products exist alongside open components |
| **Local-first / air gap** | Strong default path (on-device ONNX embeds) | Possible; depends on chosen stack | Possible; depends on chosen stack | Open libraries + optional services; check your deployment |
| **MCP-native server** | Ships **`pdf-to-rag-mcp`** (stdio) and **`pdf-to-rag-mcp-http`** | Via community / host-specific bridges | Via community / host-specific bridges | Separate from core; ecosystem tooling varies |
| **Install surface** | Single npm package + Node 18+; native addon for HNSW | Large optional dependency graph by integration | Large optional dependency graph by integration | Multiple packages / services depending on use case |
| **Citation-style hits** | **Core product:** `QueryHit` / MCP `data.hits` with verbatim `text`, `fileName`, `page` | Pattern-based; you wire retrieval + prompt | Pattern-based; you wire retrieval + prompt | Extraction/partitioning; retrieval is usually your other tools |

## When pdf-to-rag fits well

You want a **small, auditable** pipeline from **PDF folders** to **quoted passages** with **file + page**, exposed as **CLI**, **importable library**, and **MCP tools**, without committing to a full agent framework.

## When to combine with others

Use **Unstructured** (or similar) if you need **rich document structure** beyond this repo’s text-chunk path. Use **LangChain** or **LlamaIndex** if you are standardizing on their **ecosystem** (specific vector DBs, agents, eval harnesses). pdf-to-rag can still be a **retrieval backend** you call from your own code.

## Links (verify upstream)

- [LangChain](https://www.langchain.com/) — [docs](https://python.langchain.com/) / [JS](https://js.langchain.com/)
- [LlamaIndex](https://www.llamaindex.ai/) — [docs](https://docs.llamaindex.ai/)
- [Unstructured](https://unstructured.io/) — [open source](https://github.com/Unstructured-IO/unstructured)

See also the root [README.md](../../README.md) and [requirements § D10](../management/requirements.md).
