#!/usr/bin/env tsx
/**
 * evaluate-news.ts — Hard Data-Driven Scoring (no LLM judgement calls).
 *
 * The LLM is NOT qualified to judge "scientific value" — so it doesn't.
 * This script collects CONCRETE metrics via lightweight HTTP/JSON APIs and
 * sums points deterministically.
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
 * Gate: only articles with score > 65 reach the dashboard pipeline.
 * Daily cap: at most --daily-cap (default 5) approved articles per UTC day.
 *
 * Usage:
 *   npx tsx scripts/hermes/evaluate-news.ts --batch [--daily-cap 5]
 *   npx tsx scripts/hermes/evaluate-news.ts --id 42
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, isNotNull, inArray, gte, desc } from "drizzle-orm";
import { fetchYoutubeMetadata } from "./youtube-transcript";

const FETCH_TIMEOUT_MS = 20_000;
const UA = "science-agent/2.0 (+https://159.194.236.68:3000)";

const SCORE_GATE = 65; // strictly greater passes
const RELEASE_MAX_AGE_MS = 72 * 3600_000;

// ─── Source tiers for Science scoring ───────────────────────────────────────

const TIER1_SCIENCE = new Set([
  "nature",
  "science",
  "lancet",
  "cell",
  "openai-blog",
  "anthropic-blog",
  "google-ai-blog",
  "deepmind-blog",
]);

const TIER2_SCIENCE = new Set([
  "mit-tech-review",
  "huggingface-blog",
  // arXiv/conference names detected by content regex, not source slug
]);

const OPEN_LICENSES = new Set(["MIT", "Apache-2.0"]);

/** AI product/project names (EN+RU) that generic AI_TERMS misses in video titles. */
const YOUTUBE_AI_TERMS =
  /\b(gpt|chatgpt|claude|codex|gemini|openai|anthropic|deepseek|llama|mistral|qwen|copilot|sora|veo|nano[ -]banana|grok|diffusion|transformer|agent|agents|robot|llm|mcp|rag)\b|\b(ии|нейросет\w*|нейрон\w*|искусственн\w*)\b/iu;

/** Channels whose entire content is AI — topic bonus needs no keyword proof. */
const DEDICATED_AI_CHANNELS = new Set([
  "youtube-two-minute-papers",
  "youtube-yannic-kilcher",
  "youtube-matthew-berman",
  "youtube-vladimir-ai-dev",
  "youtube-rinat-suleymanov",
  "youtube-duncan-rogoff",
  "youtube-mcdenil",
  "youtube-artemii-miller",
  "youtube-diy-smart-code",
]);

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
}

// ─── HTTP utilities ─────────────────────────────────────────────────────────

function parseArgs(): { id: number | null; batch: boolean; dailyCap: number } {
  const a = process.argv.slice(2);
  const idIdx = a.indexOf("--id");
  const capIdx = a.indexOf("--daily-cap");
  return {
    id: idIdx >= 0 ? parseInt(a[idIdx + 1] || "", 10) : null,
    batch: a.includes("--batch") || idIdx < 0,
    dailyCap: capIdx >= 0 ? parseInt(a[capIdx + 1] || "5", 10) : 5,
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

async function redditUps(url: string): Promise<number> {
  const data = await fetchJson<{
    data?: { children?: { data?: { ups?: number } }[] };
  }>(`https://www.reddit.com/search.json?q=url:${encodeURIComponent(url)}&limit=5&sort=top`);
  let best = 0;
  for (const ch of data?.data?.children ?? []) best = Math.max(best, ch.data?.ups ?? 0);
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
  return TIER1_SCIENCE.has(source) || TIER2_SCIENCE.has(source);
}

async function evaluate(article: {
  id: number;
  title: string;
  originalUrl: string;
  source: string;
  isScience: boolean;
  metrics: unknown;
}): Promise<EvalResult> {
  const breakdown: ScoreBreakdown[] = [];
  const prev = (article.metrics as Record<string, unknown>) || {};
  const metrics: Record<string, unknown> = { ...prev };

  let githubStars = typeof prev.githubStars === "number" ? prev.githubStars : null;
  let githubLicense = typeof prev.githubLicense === "string" ? prev.githubLicense : null;
  let githubCreatedAt: string | null = typeof prev.githubCreatedAt === "string" ? prev.githubCreatedAt : null;
  let githubDescription: string | null = typeof prev.githubDescription === "string" ? prev.githubDescription : null;
  let githubTopics: string[] = Array.isArray(prev.githubTopics) ? (prev.githubTopics as string[]) : [];
  let hnPoints = typeof prev.hnPoints === "number" ? prev.hnPoints : null;
  let redditUpsN = typeof prev.redditUps === "number" ? prev.redditUps : null;
  let hasOpenArtifact = false;

  // ── YouTube scoring: curated channels are hand-picked (like tier-1 blogs),
  // so authority comes from the channel itself. Videos still need an
  // AI-relevant title to pass the gate; no GitHub/HN/Reddit lookups (a watch
  // page yields no useful page signals and only wastes requests).
  const isYoutube = article.source.startsWith("youtube-") || prev.origin === "youtube-rss";
  if (isYoutube) {
    let score = 45;
    breakdown.push({
      criterion: "youtube-curated-channel",
      points: 45,
      evidence: `source=${article.source}`,
    });
    // Evidence: title + video description (via yt-dlp metadata, no download).
    const meta = await fetchYoutubeMetadata(article.originalUrl);
    if (meta) {
      metrics.youtubeChannel = meta.channel;
      metrics.youtubeDescription = meta.description.slice(0, 500);
    }
    const evidenceText = `${article.title} ${meta?.description ?? ""}`;
    if (
      DEDICATED_AI_CHANNELS.has(article.source) ||
      hasAny(evidenceText, YOUTUBE_AI_TERMS) ||
      hasAny(evidenceText, AI_TERMS)
    ) {
      score += 15;
      breakdown.push({
        criterion: "youtube-ai-topic",
        points: 15,
        evidence: DEDICATED_AI_CHANNELS.has(article.source)
          ? "dedicated AI channel"
          : "AI terms in title/description",
      });
    }
    score += 10;
    breakdown.push({ criterion: "video-format", points: 10, evidence: "transcribed video essay/review" });
    metrics.youtubeScoring = true;
    return { id: article.id, title: article.title, score, breakdown, metrics };
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
  if (redditUpsN === null) redditUpsN = await redditUps(article.originalUrl);

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

  if (article.isScience || isScienceSource(article.source)) {
    // ── Science scoring ──

    // Source tier
    if (TIER1_SCIENCE.has(article.source)) {
      score += 45;
      breakdown.push({ criterion: "tier1-source", points: 45, evidence: `source=${article.source}` });
    } else if (TIER2_SCIENCE.has(article.source) || hasAny(evidenceText, /\bNeurIPS\b|\bCVPR\b|\bICLR\b/)) {
      score += 30;
      breakdown.push({ criterion: "tier2-source", points: 30, evidence: `source=${article.source}` });
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

    // Topic bonus
    if (hasAiAndDomain(evidenceText)) {
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

  return { id: article.id, title: article.title, score, breakdown, metrics };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { id, batch, dailyCap } = parseArgs();
  const db = getDb();

  let targets;
  if (id) {
    targets = await db.select().from(news).where(eq(news.id, id)).limit(1);
  } else if (batch) {
    targets = await db
      .select()
      .from(news)
      .where(and(eq(news.status, "pending"), isNull(news.score)))
      .orderBy(desc(news.createdAt))
      .limit(200);
  } else {
    targets = [];
  }

  if (targets.length === 0) {
    console.log(JSON.stringify({ status: "ok", evaluated: 0, approved: 0, rejected: 0 }));
    console.error("[evaluate-news] No unevaluated pending articles");
    process.exit(0);
  }

  console.error(`[evaluate-news] Scoring ${targets.length} articles...`);
  const results: EvalResult[] = [];
  for (const t of targets) {
    try {
      const r = await evaluate(t);
      results.push(r);
      console.error(
        `[evaluate] #${r.id} score=${r.score} ${r.breakdown.map((b) => `${b.criterion}+${b.points}`).join(", ") || "(no criteria met)"}`,
      );
    } catch (err) {
      console.error(`[evaluate] #${t.id} FAILED: ${(err as Error).message.slice(0, 120)}`);
      results.push({
        id: t.id,
        title: t.title,
        score: 0,
        breakdown: [],
        metrics: { evalError: (err as Error).message.slice(0, 200) },
      });
    }
  }

  // Daily cap: how many slots remain today (UTC)?
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const approvedToday = await db
    .select({ id: news.id })
    .from(news)
    .where(
      and(
        isNotNull(news.score),
        gte(news.score, SCORE_GATE + 1),
        inArray(news.status, ["pending", "summarized", "translated", "published"]),
        gte(news.createdAt, dayStart),
      ),
    );
  let slots = id ? dailyCap : Math.max(0, dailyCap - approvedToday.length);
  console.error(`[evaluate-news] Daily slots remaining: ${slots}/${dailyCap}`);

  // Rank and decide
  results.sort((a, b) => b.score - a.score);
  let approved = 0;
  let rejected = 0;

  for (const r of results) {
    const passesGate = r.score > SCORE_GATE;
    const approvedDecision = passesGate && slots > 0;
    const metrics = {
      ...r.metrics,
      scoreBreakdown: r.breakdown,
      evaluatedAt: new Date().toISOString(),
      decision: approvedDecision
        ? "approved"
        : passesGate
          ? "rejected-daily-cap"
          : "rejected-low-score",
    };

    if (approvedDecision) {
      slots--;
      approved++;
      await db.update(news).set({ score: r.score, metrics, updatedAt: new Date() }).where(eq(news.id, r.id));
    } else {
      rejected++;
      await db
        .update(news)
        .set({ score: r.score, metrics, status: "rejected", updatedAt: new Date() })
        .where(eq(news.id, r.id));
    }
  }

  const output = {
    status: "ok",
    evaluated: results.length,
    approved,
    rejected,
    dailyCap,
    top: results.slice(0, 5).map((r) => ({ id: r.id, score: r.score, title: r.title.slice(0, 80) })),
  };
  console.log(JSON.stringify(output));
  console.error(`[evaluate-news] Done: ${approved} approved (>${SCORE_GATE}), ${rejected} rejected`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[evaluate-news] Fatal error:", err);
  process.exit(1);
});
