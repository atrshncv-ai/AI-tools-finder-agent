#!/usr/bin/env tsx
/**
 * evaluate-news.ts — two-stage selection, deterministic scoring, score cap.
 *
 * Stage A (prefilter.ts) is free: title + RSS lead, no network. Stage B
 * (judge.ts) is one cheap LLM call on the SAME title + lead — never on the
 * page: 100 candidates a day against a budget of 8 means 90% of the work would
 * be wasted otherwise (R18.1). Only after a candidate is confirmed on-topic by
 * the judge does it compete for the day's SCORE_DAILY_CAP, and only the best
 * remaining slots get their page fetched and scored here. That cap is separate
 * from DAILY_BUDGET (publication): scoring is one cheap request and only a
 * fraction passes, so publication is not a sane bound for it.
 *
 * The LLM is NOT qualified to judge "scientific value" — so it doesn't.
 * Stage B decides topic only; the score below is deterministic:
 *
 * YouTube has two paths (see `evaluate`): legacy RSS/yt-dlp videos must prove a
 * transcript before approval, while a video collected by the official Data API
 * (`metrics.origin === "youtube-api"`) is judged and scored on its title +
 * description — the API delivers no captions and youtube.com is blocked on the
 * production host, so waiting for a transcript would reject the whole stream.
 * Such a card is marked `metrics.transcript = "unavailable-description-only"`
 * and counted separately (`counters.descriptionOnly`); ordinary videos keep the
 * transcript requirement unchanged.
 *
 * Tech scoring matrix (AI tools):
 *   +40  GitHub Trending Top-10   +25  GitHub Trending Top-50
 *   +30  GitHub stars > 10k       +20  GitHub stars > 1k
 *        +25  GitHub stars > 500 AND repo age < 1 month
 *   +30  HN/Reddit > 100 votes    +15  HN/Reddit > 30 votes
 *   +15  Tech trend bonus (MCP / AI Agent / RAG signals)
 *   +10  Open source license (MIT / Apache-2.0)
 *
 * Science scoring matrix:
 *   +45  Tier-1 source (Nature, Science, Lancet, Cell,
 *        OpenAI/Anthropic/Google/DeepMind lab blog)
 *   +30  Tier-2 source (NeurIPS/CVPR/ICLR, HuggingFace Blog, MIT Tech Review)
 *   +35  ArXiv preprint WITH open code / model / dataset
 *   +10  ArXiv preprint WITHOUT open code
 *   +20  High Altmetric score (>= 50) — proxy for active scientific discussion
 *   +15  Topic bonus: AI x chemistry/materials/biology/medicine/physics
 *
 * Gate: a score >= SCORE_GATE is approved on its own; a judge-confirmed topic
 * is approved from PUBLISH_SCORE_FLOOR (35) up, so thematic 40-45 materials
 * reach the manifest queue instead of being cut by a ranking number. Below the
 * floor a material is rejected.
 * Budgets: DAILY_BUDGET (5..10, default 8) remains the hard publication budget;
 * this stage bounds downloads by SCORE_DAILY_CAP (8..200, default 40) instead,
 * so an 8-publication day can still score 40 pages. Paid LLM work is bounded
 * twice: only the top JUDGE_MAX_CANDIDATES prefilter survivors are judged, and
 * no new judge call starts after DAILY_TOKEN_BUDGET.
 *
 * Usage:
 *   npx tsx scripts/hermes/evaluate-news.ts --batch
 *   npx tsx scripts/hermes/evaluate-news.ts --id 42
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { fetchYoutubeTranscript } from "./youtube-transcript";
import { DEDICATED_AI_YOUTUBE_SOURCES } from "./youtube-sources";
import {
  DESCRIPTION_ONLY_TRANSCRIPT,
  YOUTUBE_API_ORIGIN,
  isDescriptionOnlyVideo,
  scoreYoutubeCandidate,
} from "./youtube-policy";
import { resolveSection } from "../../api/lib/section-resolve";

import { SCORE_GATE } from "./pipeline-config";
import { hasExplicitAiSignal } from "../../api/lib/classify";
import {
  SOURCE_TIER_POINTS,
  prefilterCandidate,
  sourceTier,
  type PrefilterInput,
  type PrefilterResult,
} from "./prefilter";
import { JUDGE_CONFIDENCE_THRESHOLD, judgeRelevance, type Judgement } from "./judge";
import { directionById, sectionById, type DirectionId, type SectionId } from "./topics";
import {
  CYCLE_STAGE,
  countScoredToday,
  cycleIdFor,
  dailyBudget,
  dailyTokenBudget,
  emptyCycleMetrics,
  emptyStageUsage,
  emptyUsage,
  judgeMaxCandidates,
  publishScoreFloor,
  readCycle,
  recordCycle,
  remainingScoreBudget,
  scoreDailyCap,
  selectForPublication,
  tokenBudgetSpent,
  type CycleMetrics,
  type StageUsage,
  type UsageTotals,
} from "./publish-budget";
import {
  isProviderError,
  type CompleteJson,
  type ProviderErrorClass,
} from "../../api/ai/providers/types";

const FETCH_TIMEOUT_MS = 20_000;
const UA = process.env.AGENT_UA || "science-agent/2.0";

// ─── Source tiers for Science scoring ───────────────────────────────────────

/**
 * Authority points of a configured source (RSS feed or YouTube channel).
 * The tier sets and the +45/+30/+15 scale live in prefilter.ts, so stage A and
 * the publication score can never disagree about which tier a source is in.
 */
export function sourceAuthorityPoints(source: string): number {
  const tier = sourceTier(source);
  return tier === null ? 0 : SOURCE_TIER_POINTS[tier];
}

/** Explicit AI×science relevance bonus, granted after the hard AI gate. */
export const SCIENCE_AI_RELEVANCE_POINTS = 20;

/**
 * Points an AI-signal science material earns from its source: authority tier
 * plus the AI×science relevance bonus. Tier-3 sources land exactly on the 35
 * publication floor (15 + 20); tier-2 drug-discovery outlets clear it (30 + 20).
 */
export function scienceSourceScore(source: string): number {
  return sourceAuthorityPoints(source) + SCIENCE_AI_RELEVANCE_POINTS;
}

const OPEN_LICENSES = new Set(["MIT", "Apache-2.0"]);

// NOTE (2026-09-10 owner mandate): NO card without an explicit AI signal may
// ever be published. There is intentionally NO "AI by construction" exemption
// set — every non-YouTube article must show an explicit AI signal in its
// relevance evidence, and every YouTube video must show one in
// title/description. Curated sources keep scoring bonuses (authority), but
// never a relevance pass.
// ─── Regex helpers for text signals ─────────────────────────────────────────

const AI_TERMS =
  /\b(ai|artificial intelligence|machine learning|deep learning|neural network|llm|large language model|genai|generative ai)\b/gi;

const TECH_TREND_TERMS =
  /\b(mcp|model context protocol|ai agent|agent framework|autonomous agent|rag|retrieval[ -]augmented generation)\b/gi;

const SCIENCE_DOMAIN_TERMS =
  /\b(chemistry|materials? science|biology|biomedical|biotech|medicine|medical|oncology|physics|quantum)\b/gi;

function hasAny(text: string, re: RegExp): boolean {
  re.lastIndex = 0;
  return re.test(text);
}

function hasAiAndDomain(text: string): boolean {
  return hasAny(text, AI_TERMS) && hasAny(text, SCIENCE_DOMAIN_TERMS);
}

export { hasAiAndDomain };

/** Chars of page body that count as relevance evidence (title-adjacent lead). */
export const RELEVANCE_LEAD_CHARS = 1500;

/**
 * Relevance evidence for the hard AI gate and the ai-domain-intersection
 * bonus: title + lead of the page text (first 1500 chars) + github
 * description/topics as today.
 *
 * WHY lead-only: incidental deep-body mentions faked relevance — e.g. one
 * "machine learning" 4000 chars deep in a Nature page body plus a medicine
 * domain word cleared both hasExplicitAiSignal and hasAiAndDomain, so
 * non-AI Nature news scored 60 (tier1-source 45 + bonus 15) and cleared the
 * 50 gate (2026-09-10 cleanup of 26 Nature cards). This repeats the Aug-25
 * backfill lesson (classifiers were restricted to title+description for the
 * same reason). Full pageText stays available for NON-relevance signals
 * (DOI extraction, arxiv/code links, altmetric — reproducibility evidence).
 */
export function relevanceEvidence(args: {
  title: string;
  pageText: string;
  githubDescription?: string | null;
  githubTopics?: string[];
}): string {
  const lead = (args.pageText ?? "").slice(0, RELEVANCE_LEAD_CHARS);
  return `${args.title} ${lead} ${args.githubDescription ?? ""} ${(args.githubTopics ?? []).join(" ")}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  criterion: string;
  points: number;
  evidence: string;
}

interface EvalResult {
  id: number;
  title: string;
  score: number;
  breakdown: ScoreBreakdown[];
  metrics: Record<string, unknown>;
  originalContent?: string;
  /** Re-routed section for invention candidates detected at evaluation time. */
  section?: string;
  sphereTags?: string[];
  isScience?: boolean;
  scienceField?: string | null;
}

/**
 * One row from `news` as the pipeline sees it: `lead` is the description saved
 * at collection time (`news.summary` before summarization), never the page.
 */
export interface EvaluationCandidate {
  id: number;
  title: string;
  lead: string;
  originalUrl: string;
  source: string;
  publishedAt: Date | string;
  isScience: boolean;
  language?: string | null;
  section?: string | null;
  sphereTags?: string[] | null;
  metrics?: unknown;
}

/** Judge verdict plus the provider that produced it (interfaces.md §10). */
export type JudgeVerdict = Judgement & {
  provider: string | null;
  model: string | null;
};

export type EvaluationDecision =
  | "approved"
  | "rejected-prefilter"
  | "rejected-judge"
  | "deferred-budget"
  | "rejected-low-score"
  /** The provider failed: no verdict, the candidate stays pending for a retry. */
  | "provider-error";

export interface EvaluationOutcome {
  candidate: EvaluationCandidate;
  decision: EvaluationDecision;
  prefilter: PrefilterResult | null;
  verdict: JudgeVerdict | null;
  result: EvalResult | null;
  /** Full `news.metrics` payload to persist for this row. */
  metrics: Record<string, unknown>;
}

export interface EvaluationCycleResult {
  outcomes: EvaluationOutcome[];
  counters: CycleMetrics;
  /** Candidates whose page was fetched and scored (the day's score cap). */
  scored: number;
  /** Judge LLM calls actually made (reused verdicts cost nothing). */
  judgeCalls: number;
  /** Token spend of this run, split by judge/review/summary (R13). */
  usage: UsageTotals;
  /** The day's hard token limit was reached: no further judge calls were made. */
  tokenBudgetExceeded: boolean;
  /**
   * Error classes of provider calls that failed during this run. Non-empty
   * means the cycle cannot be trusted as a material decision and must exit
   * non-zero (R14/R17) — the candidates are left pending, not rejected.
   */
  providerErrors: ProviderErrorClass[];
}

export interface EvaluationDeps {
  now?: Date;
  /** LLM answer source for the judge; absent = no provider, fail-closed. */
  completeJson?: CompleteJson | null;
  /** Cheap stage A; defaults to the real prefilter. */
  prefilter?: (input: PrefilterInput) => PrefilterResult;
  /** Expensive scoring; defaults to the real page-scoring `evaluate`. */
  score?: (candidate: EvaluationCandidate) => Promise<EvalResult>;
  /** Day's hard token limit; defaults to `DAILY_TOKEN_BUDGET` (env). */
  tokenBudget?: number;
  /** Tokens the day has already spent before this run. */
  spentTokens?: number;
  /** Cap on paid judge candidates; defaults to `JUDGE_MAX_CANDIDATES` (env). */
  judgeMaxCandidates?: number;
  /** Publication floor; defaults to `PUBLISH_SCORE_FLOOR` (env). */
  scoreFloor?: number;
}

// ─── HTTP utilities ─────────────────────────────────────────────────────────

function parseArgs(): { id: number | null; batch: boolean } {
  const a = process.argv.slice(2);
  const idIdx = a.indexOf("--id");
  return {
    id: idIdx >= 0 ? parseInt(a[idIdx + 1] || "", 10) : null,
    batch: a.includes("--batch") || idIdx < 0,
  };
}

async function safeFetch(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: "text/html,application/json" },
      redirect: "follow",
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await safeFetch(url);
  if (!res) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function extractPageSignals(url: string): Promise<{ links: string[]; dois: string[]; text: string }> {
  const res = await safeFetch(url);
  if (!res) return { links: [], dois: [], text: "" };
  let html = "";
  try {
    html = await res.text();
  } catch {
    return { links: [], dois: [], text: "" };
  }
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href.startsWith("http")) links.add(href);
  });
  const dois = new Set<string>();
  const doiRe = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
  for (const m of html.matchAll(doiRe)) dois.add(m[0].replace(/[.)]+$/, ""));
  return { links: [...links], dois: [...dois].slice(0, 5), text: $("body").text() };
}

// ─── GitHub helpers ─────────────────────────────────────────────────────────

interface GhRepoDetails {
  stars: number;
  license: string | null;
  createdAt: string;
  description: string | null;
  topics: string[];
}

async function githubRepoDetails(fullName: string): Promise<GhRepoDetails | null> {
  const data = await fetchJson<{
    stargazers_count?: number;
    license?: { spdx_id?: string } | null;
    created_at?: string;
    description?: string;
    topics?: string[];
  }>(`https://api.github.com/repos/${fullName}`);
  if (!data || typeof data.stargazers_count !== "number") return null;
  return {
    stars: data.stargazers_count,
    license: data.license?.spdx_id ?? null,
    createdAt: data.created_at ?? "",
    description: data.description ?? null,
    topics: data.topics ?? [],
  };
}

function githubFullNameFromUrl(url: string): string | null {
  const m = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!m) return null;
  if (["topics", "trending", "collections", "features"].includes(m[1])) return null;
  return `${m[1]}/${m[2]}`;
}

async function hackerNewsPoints(url: string, title: string): Promise<number> {
  const byUrl = await fetchJson<{ hits: { points?: number }[] }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
      url,
    )}&restrictSearchableAttributes=url&hitsPerPage=5`,
  );
  let best = 0;
  for (const h of byUrl?.hits ?? []) best = Math.max(best, h.points ?? 0);
  if (best === 0 && title) {
    const byTitle = await fetchJson<{ hits: { points?: number }[] }>(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
        title.slice(0, 100),
      )}&tags=story&hitsPerPage=5`,
    );
    for (const h of byTitle?.hits ?? []) best = Math.max(best, h.points ?? 0);
  }
  return best;
}

async function altmetricScore(doi: string): Promise<number | null> {
  const data = await fetchJson<{ score?: number }>(
    `https://api.altmetric.com/v1/doi/${encodeURIComponent(doi)}`,
  );
  return typeof data?.score === "number" ? Math.round(data.score) : null;
}

// ─── Core evaluator ─────────────────────────────────────────────────────────

function isScienceSource(source: string): boolean {
  return sourceTier(source) !== null;
}

/**
 * Authority points for a tiered YouTube channel; undefined for a legacy
 * channel, which youtube-policy then scores at the curated-channel default.
 */
function youtubeAuthorityPoints(source: string): number | undefined {
  const tier = sourceTier(source);
  return tier === null ? undefined : SOURCE_TIER_POINTS[tier];
}

/**
 * Deterministic page scoring for one candidate. Exported for the tier/floor
 * regression tests: they must exercise the real scoring path, not a copy.
 */
export async function evaluate(article: {
  id: number;
  title: string;
  /** RSS lead saved at collection time; used for section routing, never the page. */
  lead?: string | null;
  originalUrl: string;
  source: string;
  isScience: boolean;
  section?: string | null;
  sphereTags?: string[] | null;
  metrics: unknown;
}): Promise<EvalResult> {
  const breakdown: ScoreBreakdown[] = [];
  const prev = (article.metrics as Record<string, unknown>) || {};
  const metrics: Record<string, unknown> = { ...prev };
  let section = article.section || "ai-news";
  let sphereTags = Array.isArray(article.sphereTags) ? (article.sphereTags as string[]) : [];

  let githubStars = typeof prev.githubStars === "number" ? prev.githubStars : null;
  let githubLicense = typeof prev.githubLicense === "string" ? prev.githubLicense : null;
  let githubCreatedAt: string | null = typeof prev.githubCreatedAt === "string" ? prev.githubCreatedAt : null;
  let githubDescription: string | null = typeof prev.githubDescription === "string" ? prev.githubDescription : null;
  let githubTopics: string[] = Array.isArray(prev.githubTopics) ? (prev.githubTopics as string[]) : [];
  let hnPoints = typeof prev.hnPoints === "number" ? prev.hnPoints : null;
  let redditUpsN = typeof prev.redditUps === "number" ? prev.redditUps : null;
  let hasOpenArtifact = false;

  // ── YouTube: two paths share this branch.
  //
  //   1. `metrics.origin === "youtube-api"` — the video was ingested by the
  //      official Data API (youtube-api.ts). On the production host youtube.com
  //      is blocked by hostname while youtube.googleapis.com answers, so yt-dlp
  //      can never reach the video and no transcript will ever arrive: the API
  //      gives title, description and date, and that IS the material. The
  //      candidate is judged and scored on it; yt-dlp is not called at all and
  //      `metrics.transcript = "unavailable-description-only"` records the
  //      absence as a state, never as a `transcript-unavailable` refusal.
  //
  //   2. legacy RSS/yt-dlp videos (origin `youtube-rss` or a `youtube-…`
  //      source) — unchanged: a usable transcript is verified BEFORE approval,
  //      native/automatic captions first and Whisper only as a configured
  //      fallback. Long-form 4–45 minute videos receive a ranking bonus; useful
  //      transcribed Shorts have no artificial daily quota.
  const descriptionOnly = isDescriptionOnlyVideo(prev);
  const isYoutube =
    descriptionOnly || article.source.startsWith("youtube-") || prev.origin === "youtube-rss";
  if (isYoutube) {
    if (descriptionOnly) {
      const description = (article.lead ?? "").trim();
      const aiRelevant = hasExplicitAiSignal(`${article.title} ${description}`);
      const durationSeconds =
        typeof prev.durationSeconds === "number" && Number.isFinite(prev.durationSeconds)
          ? prev.durationSeconds
          : null;
      const checkedAt = new Date().toISOString();

      // A state, not a rejection: the missing transcript is by design.
      metrics.transcript = DESCRIPTION_ONLY_TRANSCRIPT;
      metrics.youtubeDescription = description.slice(0, 500);
      metrics.youtubeDescriptionChars = description.length;
      if (durationSeconds !== null) metrics.youtubeDurationSeconds = durationSeconds;

      // Owner mandate 2026-09-10: relevance is a REAL signal. The description
      // is not exempt — no explicit AI term in title/description, no card.
      if (!aiRelevant) {
        metrics.youtubePreflight = {
          eligible: false,
          reason: "no-ai-signal",
          origin: YOUTUBE_API_ORIGIN,
          checkedAt,
        };
        breakdown.push({
          criterion: "ai-relevance-gate",
          points: 0,
          evidence: "no explicit AI signal in title/description",
        });
        return { id: article.id, title: article.title, score: 0, breakdown, metrics };
      }

      const authorityPoints = youtubeAuthorityPoints(article.source);
      const decision = scoreYoutubeCandidate({
        hasTranscript: false,
        descriptionOnly: true,
        durationSeconds,
        dedicatedChannel: DEDICATED_AI_YOUTUBE_SOURCES.has(article.source),
        aiRelevant,
        authorityPoints,
      });

      breakdown.push({
        criterion: "youtube-curated-channel",
        points: authorityPoints ?? 45,
        evidence: `source=${article.source}`,
      });
      breakdown.push({
        criterion: "youtube-ai-topic",
        points: 15,
        evidence: "AI terms in title/description",
      });
      breakdown.push({
        criterion: "youtube-description-only",
        points: 0,
        evidence: `no transcript by design (origin=youtube-api), ${description.length} chars of description`,
      });
      if (decision.longFormPriority) {
        breakdown.push({
          criterion: "youtube-long-form-priority",
          points: 10,
          evidence: `duration=${durationSeconds}s (4–45 min)`,
        });
      }
      metrics.youtubePreflight = {
        eligible: decision.eligible,
        reason: "description-only",
        origin: YOUTUBE_API_ORIGIN,
        checkedAt,
      };
      // The description IS the material, so it is stored as `originalContent`
      // the way a transcript is for the legacy path: ralph-loop.sh then skips
      // `fetch-article.ts` ("preflight content OK") and never calls yt-dlp for
      // this row. save-summary still writes the card from the description and
      // refuses a description under 200 characters.
      const material = `${article.title}\n\n${description}`.trim();
      return {
        id: article.id,
        title: article.title,
        score: decision.score,
        breakdown,
        metrics,
        originalContent: material,
        section,
        sphereTags,
      };
    }

    const transcript = await fetchYoutubeTranscript(article.originalUrl);
    if (!transcript) {
      metrics.youtubePreflight = {
        eligible: false,
        reason: "transcript-unavailable",
        checkedAt: new Date().toISOString(),
      };
      return { id: article.id, title: article.title, score: 0, breakdown, metrics };
    }

    const dedicatedChannel = DEDICATED_AI_YOUTUBE_SOURCES.has(article.source);
    const evidenceText = `${article.title} ${transcript.description}`;
    // Owner mandate 2026-09-10: topic relevance is a REAL signal only.
    // Curated-channel status gives the +45 authority bonus below, never a pass.
    const aiRelevant = hasExplicitAiSignal(evidenceText);
    if (!aiRelevant) {
      metrics.youtubePreflight = {
        eligible: false,
        reason: "no-ai-signal",
        checkedAt: new Date().toISOString(),
      };
      breakdown.push({
        criterion: "ai-relevance-gate",
        points: 0,
        evidence: "no explicit AI signal in title/description",
      });
      return { id: article.id, title: article.title, score: 0, breakdown, metrics };
    }
    const authorityPoints = youtubeAuthorityPoints(article.source);
    const decision = scoreYoutubeCandidate({
      hasTranscript: true,
      durationSeconds: transcript.durationSeconds,
      dedicatedChannel,
      aiRelevant,
      authorityPoints,
    });

    breakdown.push({
      criterion: "youtube-curated-channel",
      points: authorityPoints ?? 45,
      evidence: `source=${article.source}`,
    });
    if (aiRelevant) {
      breakdown.push({
        criterion: "youtube-ai-topic",
        points: 15,
        evidence: "AI terms in title/description",
      });
    }
    breakdown.push({
      criterion: "youtube-transcript-verified",
      points: 10,
      evidence: `${transcript.kind}, ${transcript.text.length} chars`,
    });
    if (decision.longFormPriority) {
      breakdown.push({
        criterion: "youtube-long-form-priority",
        points: 10,
        evidence: `duration=${transcript.durationSeconds}s (4–45 min)`,
      });
    }
    metrics.youtubeChannel = transcript.channel;
    metrics.youtubeDescription = transcript.description.slice(0, 500);
    metrics.youtubeDurationSeconds = transcript.durationSeconds;
    metrics.youtubeTranscriptKind = transcript.kind;
    metrics.youtubeTranscriptLanguage = transcript.lang;
    metrics.youtubeTranscriptChars = transcript.text.length;
    metrics.youtubePreflight = {
      eligible: decision.eligible,
      checkedAt: new Date().toISOString(),
    };
    const originalContent =
      `${transcript.title}. ${transcript.description}\n\n` +
      `Transcript (${transcript.kind}, ${transcript.lang}):\n${transcript.text}`;
    return {
      id: article.id,
      title: article.title,
      score: decision.score,
      breakdown,
      metrics,
      originalContent,
      section,
      sphereTags,
    };
  }

  const isGithubUrl = /github\.com\/[\w.-]+\/[\w.-]+/.test(article.originalUrl);
  let links: string[] = [];
  let dois: string[] = [];
  let pageText = "";

  // Page-level signals for non-GitHub items
  if (!isGithubUrl) {
    const signals = await extractPageSignals(article.originalUrl);
    links = signals.links;
    dois = signals.dois;
    pageText = signals.text;
  }

  // GitHub metadata: from URL itself or first github link in content
  let ghFullName: string | null = null;
  if (githubStars === null) {
    const ghLink = isGithubUrl
      ? article.originalUrl
      : links.find((l) => /github\.com\/[\w.-]+\/[\w.-]+/.test(l));
    ghFullName = ghLink ? githubFullNameFromUrl(ghLink) : null;
  } else {
    ghFullName = githubFullNameFromUrl(article.originalUrl);
  }

  if (ghFullName) {
    const details = await githubRepoDetails(ghFullName);
    if (details) {
      githubStars = details.stars;
      githubLicense = details.license;
      githubCreatedAt = details.createdAt;
      githubDescription = details.description;
      githubTopics = details.topics;
      hasOpenArtifact = true;
    }
  }

  if (!hasOpenArtifact) {
    hasOpenArtifact = links.some(
      (l) =>
        /huggingface\.co\/(models|datasets)\//.test(l) ||
        /zenodo\.org/.test(l) ||
        /kaggle\.com\/datasets/.test(l),
    );
  }

  // Social traction
  if (hnPoints === null) hnPoints = await hackerNewsPoints(article.originalUrl, article.title);
  // Reddit is intentionally disabled: it is rate-limited and its votes are
  // too noisy to be used as a quality signal.
  redditUpsN = null;

  // Altmetric (science articles with DOI)
  let altmetric: number | null = null;
  if (article.isScience || isScienceSource(article.source)) {
    const doiFromUrl = article.originalUrl.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    const doi = doiFromUrl ? doiFromUrl[0] : dois[0];
    if (doi) altmetric = await altmetricScore(doi);
  }

  metrics.githubStars = githubStars;
  metrics.githubLicense = githubLicense;
  metrics.githubRepo = ghFullName;
  metrics.githubCreatedAt = githubCreatedAt;
  metrics.githubDescription = githubDescription;
  metrics.githubTopics = githubTopics;
  metrics.hnPoints = hnPoints;
  metrics.redditUps = redditUpsN;
  metrics.altmetricScore = altmetric;
  metrics.hasOpenArtifact = hasOpenArtifact;
  metrics.dois = dois;

  // ── Score deterministically ──
  let score = 0;
  const evidenceText = `${article.title} ${pageText} ${githubDescription ?? ""} ${githubTopics.join(" ")}`;
  // Lead-only relevance evidence for the AI gate + topic bonus (see
  // relevanceEvidence: deep-body mentions must not fake AI relevance).
  const relevanceText = relevanceEvidence({
    title: article.title,
    pageText,
    githubDescription,
    githubTopics,
  });

  // ── Hard AI-relevance gate: no explicit AI signal in the relevance
  // evidence (title + lead) → reject regardless of social/source score.
  // Owner mandate 2026-09-10: NO exemptions for trusted/curated sources.
  const aiSignal = hasExplicitAiSignal(relevanceText);
  metrics.aiSignal = aiSignal;
  if (!aiSignal) {
    breakdown.push({
      criterion: "ai-relevance-gate",
      points: 0,
      evidence: "no explicit AI signal in title/content",
    });
    return { id: article.id, title: article.title, score: 0, breakdown, metrics };
  }

  // Unified three-way routing. The classifiers read title + description ONLY
  // (the page body fakes science domains — see section-resolve.ts), so the
  // saved RSS lead is passed here; the page text stays available for the
  // reproducibility signals above. Passing the title alone was the confirmed
  // cause of misrouted cards.
  const resolution = resolveSection({ title: article.title, description: article.lead ?? "", content: pageText });
  if (resolution.section !== section) {
    breakdown.push({
      criterion: "section-reroute",
      points: 0,
      evidence: `${section} -> ${resolution.section} (title + lead)`,
    });
    section = resolution.section;
  }
  sphereTags = resolution.sphereTags;
  if (resolution.section === "invention-tools") {
    score += 25;
    breakdown.push({
      criterion: "invention-tool-bonus",
      points: 25,
      evidence: "AI-for-science tool/discovery signals",
    });
  }

  if (article.isScience || isScienceSource(article.source)) {
    // ── Science scoring ──

    // Source tier (one authority award per source, strongest tier wins)
    const tier = sourceTier(article.source);
    if (tier === 1) {
      score += SOURCE_TIER_POINTS[1];
      breakdown.push({
        criterion: "tier1-source",
        points: SOURCE_TIER_POINTS[1],
        evidence: `source=${article.source}`,
      });
    } else if (tier === 2) {
      score += SOURCE_TIER_POINTS[2];
      breakdown.push({
        criterion: "tier2-source",
        points: SOURCE_TIER_POINTS[2],
        evidence: `source=${article.source}`,
      });
    } else if (tier === 3) {
      score += SOURCE_TIER_POINTS[3];
      breakdown.push({
        criterion: "tier3-source",
        points: SOURCE_TIER_POINTS[3],
        evidence: `source=${article.source}`,
      });
    } else if (hasAny(evidenceText, /\bNeurIPS\b|\bCVPR\b|\bICLR\b/)) {
      // Conference mention is the fallback for an untiered source.
      score += SOURCE_TIER_POINTS[2];
      breakdown.push({
        criterion: "tier2-source",
        points: SOURCE_TIER_POINTS[2],
        evidence: "conference mention: NeurIPS/CVPR/ICLR",
      });
    }

    // Explicit AI signal is the product's core criterion. Scored here so
    // AI×science items clear the gate even without social proof
    // (Tier-1 = 65, Tier-2 = 50). Gated on resolved science relevance:
    // otherwise every Tier-2 outlet item (mit-tech-review essays,
    // naked-science environment pieces) auto-cleared the gate at exactly 50
    // and flooded ai-news with non-science content (digest 26.08).
    const scienceFloorEligible =
      section === "science" || section === "invention-tools" || article.isScience;
    if (scienceFloorEligible) {
      score += SCIENCE_AI_RELEVANCE_POINTS;
      breakdown.push({
        criterion: "science-ai-relevance",
        points: SCIENCE_AI_RELEVANCE_POINTS,
        evidence: "explicit AI/ML signal in science-resolved content",
      });
    }

    // Reproducibility
    const isArxiv =
      /arxiv\.org/.test(article.originalUrl) ||
      article.source === "arxiv" ||
      links.some((l) => /arxiv\.org/.test(l));
    if (isArxiv) {
      if (hasOpenArtifact) {
        score += 35;
        breakdown.push({
          criterion: "arxiv-with-code",
          points: 35,
          evidence: `openArtifact=${hasOpenArtifact}, repo=${ghFullName ?? "n/a"}`,
        });
      } else {
        score += 10;
        breakdown.push({ criterion: "arxiv-preprint", points: 10, evidence: "no open artifact found" });
      }
    }

    // Social proof
    if (altmetric !== null && altmetric >= 50) {
      score += 20;
      breakdown.push({ criterion: "altmetric-buzz", points: 20, evidence: `altmetric=${altmetric}` });
    }

    // Topic bonus (lead-only relevance evidence — see relevanceEvidence)
    if (hasAiAndDomain(relevanceText)) {
      score += 15;
      breakdown.push({
        criterion: "ai-domain-intersection",
        points: 15,
        evidence: "AI + chemistry/materials/biology/medicine/physics",
      });
    }
  } else {
    // ── Tech scoring ──

    // 1) GitHub Trending velocity (rank injected by collect-dual)
    const trendingRank = typeof prev.githubTrendingRank === "number" ? prev.githubTrendingRank : null;
    metrics.githubTrendingRank = trendingRank;
    if (trendingRank !== null && trendingRank <= 10) {
      score += 40;
      breakdown.push({ criterion: "github-trending-top10", points: 40, evidence: `rank=${trendingRank}` });
    } else if (trendingRank !== null && trendingRank <= 50) {
      score += 25;
      breakdown.push({ criterion: "github-trending-top50", points: 25, evidence: `rank=${trendingRank}` });
    }

    // 2) GitHub Stars (fresh repo / established project)
    if (githubStars !== null) {
      if (githubStars > 10_000) {
        score += 30;
        breakdown.push({ criterion: "github-stars-10k", points: 30, evidence: `stars=${githubStars}` });
      } else if (githubStars > 1_000) {
        score += 20;
        breakdown.push({ criterion: "github-stars-1k", points: 20, evidence: `stars=${githubStars}` });
      } else if (
        githubStars > 500 &&
        githubCreatedAt &&
        Date.now() - new Date(githubCreatedAt).getTime() <= 30 * 24 * 3600_000
      ) {
        score += 25;
        breakdown.push({
          criterion: "github-stars-500-new",
          points: 25,
          evidence: `stars=${githubStars}, age<30d`,
        });
      }
    }

    // 3) Social traction
    const social = Math.max(hnPoints ?? 0, redditUpsN ?? 0);
    if (social > 100) {
      score += 30;
      breakdown.push({ criterion: "social-traction-100", points: 30, evidence: `best=${social}` });
    } else if (social > 30) {
      score += 15;
      breakdown.push({ criterion: "social-traction-30", points: 15, evidence: `best=${social}` });
    }

    // 4) Tech trend bonus (MCP / AI Agent / RAG)
    if (hasAny(evidenceText, TECH_TREND_TERMS)) {
      score += 15;
      breakdown.push({ criterion: "tech-trend-bonus", points: 15, evidence: "MCP/Agent/RAG detected" });
    }

    // 5) License
    if (githubLicense && OPEN_LICENSES.has(githubLicense)) {
      score += 10;
      breakdown.push({ criterion: "open-license", points: 10, evidence: `license=${githubLicense}` });
    }
  }

  return {
    id: article.id,
    title: article.title,
    score,
    breakdown,
    metrics,
    section,
    sphereTags,
    isScience: resolution.isScience,
    scienceField: resolution.scienceField,
  };
}

// ─── Stage A + B + budget ───────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isYoutubeCandidate(candidate: EvaluationCandidate): boolean {
  return (
    candidate.source.startsWith("youtube-") ||
    isDescriptionOnlyVideo(candidate.metrics) ||
    asRecord(candidate.metrics).origin === "youtube-rss"
  );
}

/** A verdict stored by a previous run is reused: the judge is paid per call. */
function readStoredVerdict(metrics: unknown): JudgeVerdict | null {
  const judge = asRecord(asRecord(metrics).judge);
  const { onTopic, section, direction, confidence, reason, provider, model } = judge;
  if (onTopic !== true) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (confidence < JUDGE_CONFIDENCE_THRESHOLD) return null;
  if (typeof section !== "string" || !sectionById(section)) return null;
  if (typeof reason !== "string" || !reason.trim()) return null;
  if (direction !== null && (typeof direction !== "string" || !directionById(direction))) return null;
  return {
    onTopic: true,
    section: section as SectionId,
    direction: (direction ?? null) as DirectionId | null,
    confidence,
    reason,
    provider: typeof provider === "string" ? provider : null,
    model: typeof model === "string" ? model : null,
  };
}

/**
 * Machine reason codes from judge.ts are single tokens (`invalid-judgement`,
 * `low-confidence`, `invalid-review`, `rejected-by-review`, …); a model's prose
 * explanation is a sentence. Codes are kept as their own counter key so a new
 * fail-closed branch never needs an edit here, and prose collapses into
 * `judge:off-topic`.
 */
function judgeRejectionReason(verdict: Judgement): string {
  const reason = verdict.reason.trim();
  return /^[a-z][a-z0-9-]{2,40}$/.test(reason) ? `judge:${reason}` : "judge:off-topic";
}

/**
 * The review call has its own, differently framed prompt (judge.ts). The usage
 * ledger needs to tell it from the verdict call so the owner sees the second
 * check's cost separately; no provider API exposes a stage name.
 */
function isReviewPrompt(args: Parameters<CompleteJson>[0]): boolean {
  return args.messages.some((message) => message.content.includes("Первый судья вынес вердикт"));
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function prefilterScoreOf(item: { prefilter: PrefilterResult }): number {
  return typeof item.prefilter.score === "number" && Number.isFinite(item.prefilter.score)
    ? item.prefilter.score
    : Number.NEGATIVE_INFINITY;
}

/**
 * The whole cycle decision, free of DB and network of its own: every
 * dependency is injectable, which is what the ticket's fetch-count and
 * judge-call tests observe.
 *
 * Order is the contract: prefilter (`title` + saved lead) → judge (same two
 * fields) → day's score budget → page download and scoring. A page is never
 * fetched for a candidate the prefilter dropped, the judge rejected, or the
 * score cap did not reach.
 *
 * Two hard stop-lines guard the paid stage: only the top `JUDGE_MAX_CANDIDATES`
 * prefilter survivors by prefilter score are judged, and once the day's
 * `DAILY_TOKEN_BUDGET` is reached no NEW judge call starts. Candidates that
 * were skipped stay pending with a machine reason (`judge:token-budget` /
 * `judge:candidate-cap`) instead of failing the cycle.
 */
export async function runEvaluationCycle(input: {
  candidates: readonly EvaluationCandidate[];
  budget: number;
  deps?: EvaluationDeps;
}): Promise<EvaluationCycleResult> {
  const deps = input.deps ?? {};
  const now = deps.now ?? new Date();
  const evaluatedAt = now.toISOString();
  const budget = Number.isFinite(input.budget) ? Math.max(0, Math.floor(input.budget)) : 0;

  const prefilter =
    deps.prefilter ?? ((candidate: PrefilterInput) => prefilterCandidate(candidate, { now }));
  const completeJson = deps.completeJson ?? null;
  const score = deps.score ?? scoreCandidate;
  const scoreFloor =
    typeof deps.scoreFloor === "number" && Number.isFinite(deps.scoreFloor)
      ? deps.scoreFloor
      : publishScoreFloor();
  const tokenBudget =
    typeof deps.tokenBudget === "number" && Number.isFinite(deps.tokenBudget)
      ? Math.max(0, Math.floor(deps.tokenBudget))
      : dailyTokenBudget();
  const judgeLimit =
    typeof deps.judgeMaxCandidates === "number" && Number.isFinite(deps.judgeMaxCandidates)
      ? Math.max(0, Math.floor(deps.judgeMaxCandidates))
      : judgeMaxCandidates();
  let spentTokens =
    typeof deps.spentTokens === "number" && Number.isFinite(deps.spentTokens)
      ? Math.max(0, Math.floor(deps.spentTokens))
      : 0;
  let tokenBudgetSkipped = 0;

  // The day's LLM spend, kept in the legacy totals and split by paid stage.
  const judgeUsage: StageUsage = emptyStageUsage();
  const reviewUsage: StageUsage = emptyStageUsage();
  const usage: UsageTotals = {
    ...emptyUsage(),
    judge: judgeUsage,
    review: reviewUsage,
    summary: emptyStageUsage(),
  };

  const counters = emptyCycleMetrics();
  counters.collected = input.candidates.length;
  const outcomes: EvaluationOutcome[] = [];

  const bump = (reason: string): void => {
    counters.rejectedByReason[reason] = (counters.rejectedByReason[reason] ?? 0) + 1;
  };
  const baseMetrics = (candidate: EvaluationCandidate): Record<string, unknown> => ({
    ...asRecord(candidate.metrics),
  });

  // ── Stage A: cheap, deterministic, no network ──
  const passed: { candidate: EvaluationCandidate; prefilter: PrefilterResult }[] = [];
  for (const candidate of input.candidates) {
    const result = prefilter({
      title: candidate.title,
      lead: candidate.lead,
      source: candidate.source,
      publishedAt: candidate.publishedAt,
      isYoutube: isYoutubeCandidate(candidate),
    });
    if (!result.keep) {
      bump(`prefilter:${result.reason}`);
      outcomes.push({
        candidate,
        decision: "rejected-prefilter",
        prefilter: result,
        verdict: null,
        result: null,
        metrics: {
          ...baseMetrics(candidate),
          prefilter: result,
          evaluatedAt,
          decision: "rejected-prefilter",
        },
      });
      continue;
    }
    passed.push({ candidate, prefilter: result });
  }
  counters.prefiltered = passed.length;

  // ── Stage B: LLM judge on title + saved lead only ──
  const meta: { provider: string | null; model: string | null } = { provider: null, model: null };
  const tracked = completeJson
    ? async (args: Parameters<CompleteJson>[0]) => {
        meta.provider = null;
        meta.model = null;
        const result = await completeJson(args);
        meta.provider = result.provider;
        meta.model = result.model;

        // Every paid answer lands in the day's ledger, split by stage. The
        // reviewer call costs its own tokens and must not hide inside "judge".
        const inputTokens = tokenCount(result.usage?.inputTokens);
        const outputTokens = tokenCount(result.usage?.outputTokens);
        usage.calls += 1;
        usage.inputTokens += inputTokens;
        usage.outputTokens += outputTokens;
        const stageUsage = isReviewPrompt(args) ? reviewUsage : judgeUsage;
        stageUsage.calls += 1;
        stageUsage.inputTokens += inputTokens;
        stageUsage.outputTokens += outputTokens;
        spentTokens += inputTokens + outputTokens;
        return result;
      }
    : null;

  let judgeCalls = 0;
  const providerErrors: ProviderErrorClass[] = [];
  const noteProviderFailure = (errorClass: ProviderErrorClass): void => {
    if (!providerErrors.includes(errorClass)) providerErrors.push(errorClass);
  };
  /** A provider failure is not a judgement: the row keeps no `judge` block and
   * no decision other than the cause, so it stays `pending` and is retried by
   * the next cycle. Reusing a stored verdict stays free, so it is still done.
   */
  const providerErrorOutcome = (
    item: { candidate: EvaluationCandidate; prefilter: PrefilterResult },
    errorClass: ProviderErrorClass,
  ): EvaluationOutcome => {
    bump(`provider:${errorClass}`);
    return {
      candidate: item.candidate,
      decision: "provider-error",
      prefilter: item.prefilter,
      verdict: null,
      result: null,
      metrics: {
        ...baseMetrics(item.candidate),
        prefilter: item.prefilter,
        evaluatedAt,
        decision: "provider-error",
        providerError: { class: errorClass },
      },
    };
  };

  /**
   * A budget stop is not a rejection: the material stays `pending` and a later
   * cycle can judge it once the day's allowance resets. `deferReason` names the
   * actual stop so the owner report never guesses.
   */
  const deferredOutcome = (
    item: { candidate: EvaluationCandidate; prefilter: PrefilterResult },
    verdict: JudgeVerdict | null,
    reason: "score-cap-reached" | "token-budget" | "candidate-cap",
  ): EvaluationOutcome => ({
    candidate: item.candidate,
    decision: "deferred-budget",
    prefilter: item.prefilter,
    verdict,
    result: null,
    metrics: {
      ...baseMetrics(item.candidate),
      prefilter: item.prefilter,
      ...(verdict ? { judge: verdict } : {}),
      evaluatedAt,
      decision: "deferred-budget",
      deferReason: reason,
    },
  });

  // Only the best prefilter survivors may reach the paid judge. A stored
  // verdict is free, so its row is processed even outside the top-N cap.
  const judgeIds = new Set(
    [...passed]
      .sort((a, b) => prefilterScoreOf(b) - prefilterScoreOf(a))
      .slice(0, judgeLimit)
      .map((item) => item.candidate.id),
  );

  const onTopic: { candidate: EvaluationCandidate; prefilter: PrefilterResult; verdict: JudgeVerdict }[] = [];
  let failedClass: ProviderErrorClass | null = null;
  for (const item of passed) {
    const stored = readStoredVerdict(item.candidate.metrics);
    if (!stored && !judgeIds.has(item.candidate.id)) {
      bump("judge:candidate-cap");
      outcomes.push(deferredOutcome(item, null, "candidate-cap"));
      continue;
    }

    let verdict: JudgeVerdict;
    if (stored) {
      // The verdict was already paid for by a previous cycle: reuse it.
      verdict = stored;
    } else if (failedClass) {
      // The provider is already known to be down: do not hammer it once per
      // candidate, but leave every affected row pending with the cause.
      outcomes.push(providerErrorOutcome(item, failedClass));
      continue;
    } else if (spentTokens >= tokenBudget) {
      // DAILY_TOKEN_BUDGET is hard: stop starting new calls, keep the row
      // pending and let the counters name the reason. This is not a crash.
      tokenBudgetSkipped++;
      bump("judge:token-budget");
      outcomes.push(deferredOutcome(item, null, "token-budget"));
      continue;
    } else {
      judgeCalls++;
      try {
        const judgement = await judgeRelevance(
          {
            title: item.candidate.title,
            lead: item.candidate.lead,
            language: item.candidate.language ?? null,
          },
          tracked ? { completeJson: tracked } : {},
        );
        verdict = { ...judgement, provider: meta.provider, model: meta.model };
      } catch (error) {
        // Only a classified provider failure is "not our material's fault"; a
        // programming error must crash loudly instead of hiding in a counter.
        if (!isProviderError(error)) throw error;
        failedClass = error.errorClass;
        noteProviderFailure(error.errorClass);
        outcomes.push(providerErrorOutcome(item, error.errorClass));
        continue;
      }
    }

    if (!verdict.onTopic) {
      bump(judgeRejectionReason(verdict));
      outcomes.push({
        candidate: item.candidate,
        decision: "rejected-judge",
        prefilter: item.prefilter,
        verdict,
        result: null,
        metrics: {
          ...baseMetrics(item.candidate),
          prefilter: item.prefilter,
          judge: verdict,
          evaluatedAt,
          decision: "rejected-judge",
        },
      });
      continue;
    }
    onTopic.push({ candidate: item.candidate, prefilter: item.prefilter, verdict });
  }
  counters.judged = onTopic.length;

  // ── Day budget: only the best reach the expensive stage ──
  // "Best" before the page is paid for = the cheap prefilter score, then the
  // judge's confidence, then freshness — the same ordering the release uses
  // (R08.1), with the prefilter score standing in for the final score that only
  // the page can produce.
  const ranked = selectForPublication(
    onTopic.map((item) => ({
      id: item.candidate.id,
      score: item.prefilter.score,
      confidence: item.verdict.confidence,
      publishedAt: item.candidate.publishedAt,
    })),
    budget,
  );
  const selectedIds = new Set(ranked.map((item) => item.id));

  let scored = 0;
  for (const item of onTopic) {
    if (!selectedIds.has(item.candidate.id)) {
      // On topic but outside the day's SCORE_DAILY_CAP: stays pending with its
      // verdict, so a later cycle can score it without paying the judge again.
      outcomes.push(deferredOutcome(item, item.verdict, "score-cap-reached"));
      continue;
    }

    scored++;
    try {
      const result = await score(item.candidate);
      // SCORE_GATE still means "important enough on its own"; the publish
      // floor lets a judge-confirmed material through at 35..49, so the day's
      // thematic news is not cut by a ranking number (owner complaint).
      const scoreGatePassed = result.score >= SCORE_GATE;
      const publishFloorPassed = item.verdict.onTopic && result.score >= scoreFloor;
      const decision: EvaluationDecision =
        scoreGatePassed || publishFloorPassed ? "approved" : "rejected-low-score";
      if (decision === "approved") {
        counters.approved++;
        // The card was built from a video description alone (no transcript):
        // counted separately so the owner sees it in the day's ledger.
        if (isDescriptionOnlyVideo(item.candidate.metrics)) counters.descriptionOnly++;
      } else bump("score:low-score");
      outcomes.push({
        candidate: item.candidate,
        decision,
        prefilter: item.prefilter,
        verdict: item.verdict,
        result,
        metrics: {
          ...baseMetrics(item.candidate),
          ...result.metrics,
          prefilter: item.prefilter,
          judge: item.verdict,
          scoreBreakdown: result.breakdown,
          scoreGatePassed,
          publishFloorPassed,
          evaluatedAt,
          // The day's download allowance is counted from this stamp: a retry
          // after a failure must not buy the same pages again.
          scoredAt: evaluatedAt,
          decision,
        },
      });
    } catch (err) {
      const message = (err as Error)?.message?.slice(0, 200) ?? "evaluation-failed";
      bump("score:error");
      outcomes.push({
        candidate: item.candidate,
        decision: "rejected-low-score",
        prefilter: item.prefilter,
        verdict: item.verdict,
        result: { id: item.candidate.id, title: item.candidate.title, score: 0, breakdown: [], metrics: {} },
        metrics: {
          ...baseMetrics(item.candidate),
          prefilter: item.prefilter,
          judge: item.verdict,
          evalError: message,
          evaluatedAt,
          scoredAt: evaluatedAt,
          decision: "rejected-low-score",
        },
      });
    }
  }

  counters.usage = usage;
  return {
    outcomes,
    counters,
    scored,
    judgeCalls,
    usage,
    tokenBudgetExceeded: tokenBudgetSkipped > 0 || spentTokens >= tokenBudget,
    providerErrors,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function toCandidate(row: typeof news.$inferSelect): EvaluationCandidate {
  return {
    id: row.id,
    title: row.title,
    lead: row.summary ?? "",
    originalUrl: row.originalUrl,
    source: row.source,
    publishedAt: row.publishedAt,
    isScience: row.isScience,
    language: row.language,
    section: row.section,
    sphereTags: row.sphereTags,
    metrics: row.metrics,
  };
}

function scoreCandidate(candidate: EvaluationCandidate): Promise<EvalResult> {
  return evaluate({
    id: candidate.id,
    title: candidate.title,
    lead: candidate.lead,
    originalUrl: candidate.originalUrl,
    source: candidate.source,
    isScience: candidate.isScience,
    section: candidate.section,
    sphereTags: candidate.sphereTags,
    metrics: candidate.metrics,
  });
}

/** The card's fields the judge owns, derived from its verdict alone (R07.1). */
export type CardPlacement = {
  section: SectionId;
  scienceField: DirectionId | null;
  sphereTags: string[];
  isScience: boolean;
};

/**
 * Placement comes from `metrics.judge`, not from a word match over the Russian
 * summary: the section is the verdict's section, the science direction is its
 * direction, and the invention spheres are derived from that same direction.
 * A word-matching router (`resolveSection`) may disagree; the judge wins.
 */
export function placementFromVerdict(verdict: JudgeVerdict | null): CardPlacement | null {
  if (!verdict || !verdict.onTopic) return null;
  return {
    section: verdict.section,
    scienceField: verdict.section === "science" ? verdict.direction : null,
    sphereTags:
      verdict.section === "invention-tools" && verdict.direction ? [verdict.direction] : [],
    isScience: verdict.section === "science",
  };
}

/** How one outcome lands in the `news` row (score, status, section). */
export function updateForOutcome(outcome: EvaluationOutcome): Record<string, unknown> {
  const set: Record<string, unknown> = { metrics: outcome.metrics, updatedAt: new Date() };
  if (outcome.decision === "approved" && outcome.result) {
    set.score = outcome.result.score;
    // One trusted decision: the judge's verdict decides where the card lands.
    const placement = placementFromVerdict(outcome.verdict);
    if (placement) {
      set.section = placement.section;
      set.sphereTags = placement.sphereTags;
      set.isScience = placement.isScience;
      set.scienceField = placement.scienceField;
    } else if (outcome.result.section) {
      // Unreachable for a real approved outcome (it is always judged); kept so
      // an injected score-only path still writes a section.
      set.section = outcome.result.section;
      set.sphereTags = outcome.result.sphereTags ?? [];
      if (outcome.result.isScience !== undefined) set.isScience = outcome.result.isScience;
      if (outcome.result.scienceField !== undefined) set.scienceField = outcome.result.scienceField;
    }
    if (outcome.result.originalContent) set.originalContent = outcome.result.originalContent;
    return set;
  }
  if (outcome.decision === "rejected-low-score") {
    set.score = outcome.result?.score ?? 0;
    set.status = "rejected";
    return set;
  }
  if (outcome.decision === "deferred-budget") {
    // Passed the judge, lost the day's SCORE_DAILY_CAP: stays pending (score
    // NULL) so a later cycle can score it without paying the judge twice.
    return set;
  }
  if (outcome.decision === "provider-error") {
    // The provider failed, the material was never judged: no score, no status.
    // The row stays pending and the cause lives in `metrics.providerError`.
    return set;
  }
  set.score = 0;
  set.status = "rejected";
  return set;
}

async function main() {
  const { id, batch } = parseArgs();
  // Two independent daily limits: publication (DAILY_BUDGET) and page scoring
  // (SCORE_DAILY_CAP). This stage only spends the latter.
  const budget = dailyBudget();
  const scoreCap = scoreDailyCap();
  const tokenBudget = dailyTokenBudget();
  const judgeLimit = judgeMaxCandidates();
  const now = new Date();
  const cycleId = cycleIdFor(now);
  const db = getDb();

  let targets: (typeof news.$inferSelect)[];
  if (id) {
    targets = await db.select().from(news).where(eq(news.id, id)).limit(1);
  } else if (batch) {
    targets = await db
      .select()
      .from(news)
      .where(and(eq(news.status, "pending"), isNull(news.score)))
      // Candidates the judge has not seen yet go first: a deferred-but-on-topic
      // backlog must never starve a fresh material out of the batch window.
      .orderBy(sql`(${news.metrics} -> 'judge') is null desc`, desc(news.createdAt))
      .limit(Math.max(200, judgeLimit));
  } else {
    targets = [];
  }

  if (targets.length === 0) {
    // Still write the day's ledger: the owner report must tell "nothing was
    // collected" from "the cycle never ran". The zero stage split keeps the
    // report's per-stage line present even on an empty day.
    await recordCycle(
      cycleId,
      {
        ...emptyCycleMetrics(),
        usage: {
          ...emptyUsage(),
          judge: emptyStageUsage(),
          review: emptyStageUsage(),
          summary: emptyStageUsage(),
        },
      },
      CYCLE_STAGE.evaluated,
    );
    console.log(
      JSON.stringify({ status: "ok", cycleId, budget, collected: 0, approved: 0, rejected: 0 }),
    );
    console.error("[evaluate-news] No unevaluated pending articles");
    process.exit(0);
  }

  // The day's score allowance is per DAY, not per run: retries after a failure
  // continue the same cap instead of buying more pages, and the "page only for
  // the score cap" rule holds for the whole day. It is NOT DAILY_BUDGET: an
  // 8-publication day may score 40 pages, and only about a third of them pass.
  const scoredToday = await countScoredToday(now);
  const downloadBudget = id ? 1 : remainingScoreBudget(scoreCap, scoredToday);

  // The token limit is per DAY too: the ledger already holds the spend of the
  // previous runs of this cycle, and a retry must continue it instead of
  // starting a fresh 800k allowance.
  const priorCycle = await readCycle(cycleId);
  const spentTokens = tokenBudgetSpent(priorCycle?.metrics.usage);

  console.error(
    `[evaluate-news] ${targets.length} candidates, score cap=${scoreCap} ` +
      `(publish budget=${budget}), judge cap=${judgeLimit}, ` +
      `tokens ${spentTokens}/${tokenBudget}, ` +
      `pages left today=${downloadBudget} (${scoredToday} already scored)`,
  );

  // Provider chain (GigaChat → OpenCode, error classification from task 02).
  // Usage is accumulated inside `runEvaluationCycle`, stage by stage, so the
  // hard token stop can see the spend of the calls it just made.
  const { createProviderChain } = await import("../../api/ai/providers/chain");
  const chain = createProviderChain();

  const cycle = await runEvaluationCycle({
    candidates: targets.map(toCandidate),
    // A manual `--id` run is one article: it must not be blocked by the day's
    // score cap, but it still never fetches more than one page.
    budget: downloadBudget,
    deps: {
      now,
      completeJson: chain.completeJson,
      tokenBudget,
      spentTokens,
      judgeMaxCandidates: judgeLimit,
    },
  });

  for (const outcome of cycle.outcomes) {
    await db.update(news).set(updateForOutcome(outcome)).where(eq(news.id, outcome.candidate.id));
    console.error(
      `[evaluate] #${outcome.candidate.id} ${outcome.decision}` +
        (outcome.result ? ` score=${outcome.result.score}` : "") +
        (outcome.verdict ? ` judge=${outcome.verdict.confidence.toFixed(2)}` : "") +
        (outcome.prefilter ? ` prefilter="${outcome.prefilter.reason}"` : ""),
    );
  }

  const counters = await recordCycle(
    cycleId,
    cycle.counters,
    CYCLE_STAGE.evaluated,
  );

  const deferred = cycle.outcomes.filter((o) => o.decision === "deferred-budget").length;
  const providerFailed = cycle.outcomes.filter((o) => o.decision === "provider-error").length;
  const tokenBudgetSkipped = counters.rejectedByReason["judge:token-budget"] ?? 0;
  const output = {
    status: cycle.providerErrors.length > 0 ? "provider-error" : "ok",
    cycleId,
    budget,
    scoreDailyCap: scoreCap,
    downloadBudget,
    scoredToday,
    tokenBudget,
    tokensSpent: tokenBudgetSpent(counters.usage),
    tokenBudgetExceeded: cycle.tokenBudgetExceeded,
    tokenBudgetSkipped,
    collected: counters.collected,
    prefiltered: counters.prefiltered,
    judged: counters.judged,
    approved: counters.approved,
    // Cards whose material was a Data API video description (no transcript).
    descriptionOnly: counters.descriptionOnly,
    deferred,
    rejected: cycle.outcomes.filter((o) => o.decision.startsWith("rejected")).length,
    judgeCalls: cycle.judgeCalls,
    scored: cycle.scored,
    providerErrors: cycle.providerErrors,
    providerFailed,
    top: cycle.outcomes
      .filter((o) => o.decision === "approved" && o.result)
      .sort((a, b) => (b.result?.score ?? 0) - (a.result?.score ?? 0))
      .slice(0, 5)
      .map((o) => ({ id: o.candidate.id, score: o.result?.score, title: o.candidate.title.slice(0, 80) })),
  };
  console.log(JSON.stringify(output));
  console.error(
    `[evaluate-news] Done: collected=${counters.collected} prefiltered=${counters.prefiltered} ` +
      `judged=${counters.judged} approved=${counters.approved} ` +
      `descriptionOnly=${counters.descriptionOnly} deferred=${deferred} ` +
      `scored=${cycle.scored} judgeCalls=${cycle.judgeCalls}`,
  );
  if (cycle.providerErrors.length > 0) {
    // The cycle did not decide about these materials: the loop must retry, and
    // the owner report names the provider class, not "material rejected" (R14).
    console.error(
      `[evaluate-news] PROVIDER FAILURE (${cycle.providerErrors.join(", ")}): ` +
        `${providerFailed} candidates left pending — exiting non-zero`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// Only auto-run when executed directly (npx tsx .../evaluate-news.ts).
// Importing this module (e.g. from vitest) must not run the pipeline.
const invokedDirectly = (process.argv[1] ?? "").endsWith("evaluate-news.ts");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[evaluate-news] Fatal error:", err);
    process.exit(1);
  });
}
