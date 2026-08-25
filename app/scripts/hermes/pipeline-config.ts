/**
 * pipeline-config.ts — Single source of truth for Hermes pipeline thresholds.
 *
 * SCORE_GATE is the ONE approval threshold shared by evaluate-news.ts
 * (approval/rejection) and manifest-gen.ts (LLM processing queue). Both must
 * import it — a second hardcoded number anywhere else is a bug (it previously
 * created an eternal pending limbo for scores between the two gates).
 *
 * Content relevance is enforced separately by the hard AI-signal gate in
 * evaluate-news.ts and the AI requirement in invention-classify.ts; the score
 * only ranks importance of already-relevant articles.
 */
export const SCORE_GATE = 50;
