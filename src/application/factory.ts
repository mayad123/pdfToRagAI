import { join, resolve } from "node:path";
import type { PdfToRagConfig } from "../config/defaults.js";
import { createOllamaEmbedder, createTransformersEmbedder } from "../embeddings.js";
import { FileVectorStore } from "../storage/file-store.js";
import type { Embedder } from "../embeddings.js";
import type { AppDeps } from "./deps.js";

function embedBackendFromEnv(): "transformers" | "ollama" {
  const raw = (process.env.PDF_TO_RAG_EMBED_BACKEND || "transformers").trim().toLowerCase();
  if (raw === "ollama") return "ollama";
  return "transformers";
}

/** Resolved embedding model id string (stored in index header and config). */
export function resolveEmbeddingModelId(config: PdfToRagConfig): string {
  const backend = embedBackendFromEnv();
  if (backend === "ollama") {
    const ollamaModel = process.env.OLLAMA_EMBED_MODEL?.trim() ?? "";
    return `ollama:${ollamaModel}`;
  }
  return config.embeddingModel;
}

/** Creates only the Embedder for the configured backend. */
export async function createAppEmbedder(config: PdfToRagConfig): Promise<Embedder> {
  const backend = embedBackendFromEnv();

  if (backend === "ollama") {
    const ollamaModel = process.env.OLLAMA_EMBED_MODEL?.trim();
    if (!ollamaModel) {
      throw new Error(
        "PDF_TO_RAG_EMBED_BACKEND=ollama requires OLLAMA_EMBED_MODEL (e.g. nomic-embed-text). For the default Transformers.js path, unset PDF_TO_RAG_EMBED_BACKEND or set it to transformers."
      );
    }
    const host = process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
    return createOllamaEmbedder(host, ollamaModel);
  }

  return createTransformersEmbedder(config.embeddingModel);
}

export async function createAppDeps(
  cwd: string,
  config: PdfToRagConfig
): Promise<AppDeps> {
  const embedder = await createAppEmbedder(config);
  const embeddingModelId = resolveEmbeddingModelId(config);
  const indexPath = join(resolve(cwd), config.storeDir, config.indexFileName);
  const store = new FileVectorStore(indexPath, embeddingModelId);
  const merged: PdfToRagConfig = { ...config, embeddingModel: embeddingModelId };
  return { config: merged, store, embedder };
}
