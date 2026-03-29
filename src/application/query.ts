import type { QueryHit } from "../domain/results.js";
import type { Hooks } from "../hooks/types.js";
import { searchQuery } from "../query/search.js";
import type { AppDeps } from "./deps.js";

/**
 * Run semantic retrieval for a natural-language question or phrase.
 * Results are ranked chunks (`QueryHit[]`); length is the match count (≤ `deps.config.topK`).
 * When hypotheticalAnswer is provided (HyDE, F15), it is embedded instead of the question.
 */
export async function runQuery(
  question: string,
  deps: AppDeps,
  hooks: Hooks,
  minScore?: number,
  hypotheticalAnswer?: string
): Promise<QueryHit[]> {
  await hooks.beforeQuery({ question });
  return searchQuery(question, deps.config, deps.embedder, deps.store, minScore, hypotheticalAnswer);
}
