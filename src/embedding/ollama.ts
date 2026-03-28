import type { Embedder } from "./types.js";

function normalizeBaseUrl(base: string): string {
  return base.replace(/\/$/, "");
}

function l2Normalize(vec: number[]): number[] {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return vec.map((x) => x / n);
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 1 }, () => worker());
  await Promise.all(workers);
  return results;
}

interface OllamaEmbedOptions {
  batchSize: number;
  concurrency: number;
}

/**
 * Embeddings via local Ollama HTTP API. Prefers POST /api/embed (batched `input`);
 * falls back to POST /api/embeddings per text if /api/embed is unavailable.
 */
export async function createOllamaEmbedder(
  baseUrl: string,
  model: string,
  options?: Partial<OllamaEmbedOptions>
): Promise<Embedder> {
  const base = normalizeBaseUrl(baseUrl);
  const batchSize = Math.max(
    1,
    options?.batchSize ?? (Number.parseInt(process.env.OLLAMA_EMBED_BATCH_SIZE || "128", 10) || 128)
  );
  const concurrency = Math.max(
    1,
    options?.concurrency ?? (Number.parseInt(process.env.OLLAMA_EMBED_CONCURRENCY || "8", 10) || 8)
  );

  let useLegacyEmbeddingsOnly = false;

  async function postJson(path: string, body: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function embedViaApiEmbed(inputs: string[]): Promise<number[][]> {
    const res = await postJson("/api/embed", { model, input: inputs });
    if (res.status === 404) {
      useLegacyEmbeddingsOnly = true;
      throw new Error("OLLAMA_API_EMBED_404");
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Ollama /api/embed failed (${res.status}): ${t.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      embeddings?: number[][];
      embedding?: number[];
    };
    if (data.embeddings && Array.isArray(data.embeddings)) {
      return data.embeddings.map((v) => l2Normalize(v.map(Number)));
    }
    if (data.embedding && Array.isArray(data.embedding) && inputs.length <= 1) {
      return [l2Normalize(data.embedding.map(Number))];
    }
    throw new Error("Unexpected Ollama /api/embed response: missing embeddings array");
  }

  async function embedViaApiEmbeddingsOne(prompt: string): Promise<number[]> {
    const res = await postJson("/api/embeddings", { model, prompt });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Ollama /api/embeddings failed (${res.status}): ${t.slice(0, 300)}`);
    }
    const data = (await res.json()) as { embedding?: number[] };
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error("Unexpected Ollama /api/embeddings response: missing embedding");
    }
    return l2Normalize(data.embedding.map(Number));
  }

  async function embedLegacy(texts: string[]): Promise<number[][]> {
    return mapPool(texts, concurrency, (t) => embedViaApiEmbeddingsOne(t));
  }

  async function embedOne(text: string): Promise<number[]> {
    if (useLegacyEmbeddingsOnly) {
      return embedViaApiEmbeddingsOne(text);
    }
    try {
      const rows = await embedViaApiEmbed([text]);
      return rows[0]!;
    } catch (e) {
      if (e instanceof Error && e.message === "OLLAMA_API_EMBED_404") {
        return embedViaApiEmbeddingsOne(text);
      }
      throw e;
    }
  }

  async function embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (useLegacyEmbeddingsOnly) {
      return embedLegacy(texts);
    }
    const out: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const rows = await embedViaApiEmbed(batch);
        if (rows.length !== batch.length) {
          throw new Error(
            `Ollama returned ${rows.length} embeddings for ${batch.length} inputs; check model and Ollama version`
          );
        }
        out.push(...rows);
      }
      return out;
    } catch (e) {
      if (e instanceof Error && e.message === "OLLAMA_API_EMBED_404") {
        return embedLegacy(texts);
      }
      throw e;
    }
  }

  return { embed, embedOne };
}
