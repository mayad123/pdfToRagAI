export type EmbedRole = "query" | "passage";

export interface Embedder {
  embed(texts: string[], role?: EmbedRole): Promise<number[][]>;
  embedOne(text: string, role?: EmbedRole): Promise<number[]>;
}
