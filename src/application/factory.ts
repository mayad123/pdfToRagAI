import { join, resolve } from "node:path";
import type { PdfToRagConfig } from "../config/defaults.js";
import { createOllamaEmbedder, createTransformersEmbedder } from "../embeddings.js";
import { FileVectorStore } from "../storage/file-store.js";
import type { AppDeps } from "./deps.js";

function embedBackendFromEnv(): "transformers" | "ollama" {
  const raw = (process.env.PDF_TO_RAG_EMBED_BACKEND || "transformers").trim().toLowerCase();
  if (raw === "ollama") return "ollama";
  return "transformers";
}

export async function createAppDeps(
  cwd: string,
  config: PdfToRagConfig
): Promise<AppDeps> {
  const indexPath = join(resolve(cwd), config.storeDir, config.indexFileName);
  const backend = embedBackendFromEnv();

  if (backend === "ollama") {
    const ollamaModel = process.env.OLLAMA_EMBED_MODEL?.trim();
    if (!ollamaModel) {
      throw new Error(
        "PDF_TO_RAG_EMBED_BACKEND=ollama requires OLLAMA_EMBED_MODEL (e.g. nomic-embed-text). For the default Transformers.js path, unset PDF_TO_RAG_EMBED_BACKEND or set it to transformers."
      );
    }
    const host = process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
    const embeddingModelId = `ollama:${ollamaModel}`;
    const store = new FileVectorStore(indexPath, embeddingModelId);
    const embedder = await createOllamaEmbedder(host, ollamaModel);
    const merged: PdfToRagConfig = { ...config, embeddingModel: embeddingModelId };
    return { config: merged, store, embedder };
  }

  const store = new FileVectorStore(indexPath, config.embeddingModel);
  const embedder = await createTransformersEmbedder(config.embeddingModel);
  return { config, store, embedder };
}
