/**
 * pipeline-config.ts — Single source of truth for Hermes pipeline thresholds.
 *
 * SCORE_GATE is the formal approval threshold: an already-relevant article
 * clears it on importance alone and needs no further evidence.
 *
 * PUBLISH_SCORE_FLOOR is the publication floor. A material the judge confirmed
 * as on-topic is published from this score up even when it does not reach
 * SCORE_GATE: the judge already proved relevance, and the score only ranks
 * importance. Without this split, a gate of 50 cut judge-approved 40-45 items
 * and a whole day produced one card instead of five to ten.
 *
 * DAILY_TOKEN_BUDGET is the hard daily LLM spend (input + output tokens): the
 * evaluate stage stops paying for new judge calls once it is reached, so a
 * retry loop cannot burn the month's balance in a day.
 *
 * JUDGE_MAX_CANDIDATES caps how many prefilter survivors reach the paid judge;
 * they are chosen by prefilter score, best first.
 *
 * The exported constants are the defaults. The environment override lives next
 * to the rest of the budget parsing in publish-budget.ts (`dailyTokenBudget()`,
 * `judgeMaxCandidates()`, `publishScoreFloor()`), which keeps this module free
 * of `process.env` reads at import time.
 *
 * Content relevance is enforced separately by the hard AI-signal gate in
 * evaluate-news.ts and the AI requirement in invention-classify.ts; the score
 * only ranks importance of already-relevant articles.
 */
export const SCORE_GATE = 50;

/** A judge-approved material at or above this score may be published. */
export const PUBLISH_SCORE_FLOOR = 35;

/** Hard daily token limit (input + output) for all LLM stages. */
export const DAILY_TOKEN_BUDGET = 800_000;

/** At most this many prefilter survivors are sent to the paid judge per cycle. */
export const JUDGE_MAX_CANDIDATES = 200;
