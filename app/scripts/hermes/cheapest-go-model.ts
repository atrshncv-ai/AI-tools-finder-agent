#!/usr/bin/env tsx
/**
 * cheapest-go-model.ts — Pin the cheapest OpenCode Go model for the pipeline.
 *
 * Fetches the live Go catalog (no auth, 15s timeout), resolves the cheapest
 * model via resolveCheapestGoModel(), prints JSON {model, available, source}
 * to stdout and diagnostics to stderr.
 *
 * Usage (human operators run this to pin ZEN_GO_MODEL on the server):
 *   cd app && npx tsx scripts/hermes/cheapest-go-model.ts
 *
 * Exit 0 on success, 1 on fetch failure (fallback recommendation to stderr).
 */

import {
  CHEAPEST_GO_MODELS_FIRST,
  DEFAULT_GO_MODEL,
  GO_BASE_URL_DEFAULT,
  resolveCheapestGoModel,
} from "../../api/ai/goModels";

const GO_BASE = (process.env.ZEN_GO_BASE_URL || GO_BASE_URL_DEFAULT).replace(/\/+$/, "");
const FETCH_TIMEOUT_MS = 15000;

interface ModelsResponse {
  data?: { id?: unknown }[];
}

async function fetchModelIds(): Promise<string[]> {
  const res = await fetch(`${GO_BASE}/models`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${GO_BASE}/models`);
  }
  const data = (await res.json()) as ModelsResponse | { id?: unknown }[];
  const list = Array.isArray(data) ? data : data.data;
  if (!Array.isArray(list)) {
    throw new Error("unexpected /models response shape (expected {data:[{id}]})");
  }
  const ids = list
    .map((m) => (typeof m?.id === "string" ? m.id : ""))
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    throw new Error("empty model list in /models response");
  }
  return ids;
}

async function main(): Promise<void> {
  let ids: string[];
  try {
    ids = await fetchModelIds();
  } catch (err) {
    console.error(
      `[cheapest-go-model] FAILED to fetch ${GO_BASE}/models: ${(err as Error).message}`,
    );
    console.error(
      `[cheapest-go-model] Fallback recommendation: set ZEN_GO_MODEL=${DEFAULT_GO_MODEL} ` +
        `(cheapest known Go model; preference order: ${CHEAPEST_GO_MODELS_FIRST.join(", ")}).`,
    );
    process.exitCode = 1;
    return;
  }
  const model = resolveCheapestGoModel(ids);
  console.error(
    `[cheapest-go-model] Resolved cheapest Go model: ${model} ` +
      `(preference: ${CHEAPEST_GO_MODELS_FIRST.join(", ")})`,
  );
  console.log(JSON.stringify({ model, available: ids, source: "go-catalog" }));
}

void main();
