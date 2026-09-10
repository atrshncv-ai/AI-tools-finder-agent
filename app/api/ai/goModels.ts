/**
 * goModels.ts — cheapest-model policy for the OpenCode Go endpoint.
 *
 * Pure module (no I/O, no secrets): maps the live Go catalog to a
 * cheapest-first preference order for the Hermes pipeline.
 *
 * Live catalog (no auth): https://opencode.ai/zen/go/v1/models
 * Every entry of CHEAPEST_GO_MODELS_FIRST was verified present in that
 * catalog. Human operators pin the model via:
 *   cd app && npx tsx scripts/hermes/cheapest-go-model.ts
 * then set the printed model id as ZEN_GO_MODEL on the server.
 */

export const GO_BASE_URL_DEFAULT = "https://opencode.ai/zen/go/v1";

/** Paid Go model the owner wants as today's cheapest default. */
export const DEFAULT_GO_MODEL = "mimo-v2.5";

/**
 * Cheapest-first preference order. First entry present in the live catalog
 * wins (see resolveCheapestGoModel). Keep entries in price order, cheapest
 * first; only include ids that exist in the Go catalog on
 * `.../go/v1/chat/completions`. kimi-k3 is deliberately excluded — at
 * $3.00/$15.00 it is ~20x the price of the listed models.
 */
export const CHEAPEST_GO_MODELS_FIRST: readonly string[] = [
  "mimo-v2.5",
  "hy3",
  "glm-5.3-flash",
  "deepseek-v4-flash",
];

/**
 * Return the first preference-list entry present in `availableIds`,
 * else the DEFAULT_GO_MODEL fallback. Pure function — safe to unit test.
 */
export function resolveCheapestGoModel(availableIds: string[]): string {
  if (Array.isArray(availableIds)) {
    for (const candidate of CHEAPEST_GO_MODELS_FIRST) {
      if (availableIds.includes(candidate)) {
        return candidate;
      }
    }
  }
  return DEFAULT_GO_MODEL;
}
