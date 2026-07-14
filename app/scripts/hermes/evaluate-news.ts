#!/usr/bin/env tsx
/**
 * evaluate-news.ts — Hard Data-Driven Scoring (no LLM judgement calls).
 *
 * The LLM is NOT qualified to judge "scientific value" — so it doesn't.
 * This script collects CONCRETE metrics via lightweight HTTP/JSON APIs and
 * sums points deterministically:
 *
 * Tech criteria (AI tools) — VELOCITY, not absolute numbers:
 *   +40  Project is in GitHub Trending (fresh repo actively gaining stars)
 *        OR a major project (> 10k stars) shipped a NEW release/tag <= 72h ago
 *   +30  Hacker News post OR Reddit post with > 100 upvotes
 *   +20  Open source license (MIT / Apache-2.0)
 *
 * Science criteria:
 *   +50  Published in a Tier-1 journal (Nature, Science, Lancet, Cell)
 *        or an official Tier-1 lab blog
 *   +40  arXiv preprint accompanied by open code / model / dataset link
 *   +30  High Altmetric score (>= 50) — proxy for active scientific discussion
 *
 * Gate: only articles with score > 75 reach the dashboard pipeline.
 * Daily cap: at most --daily-cap (default 5) approved articles per UTC day.
 *
 * Usage:
 *   npx tsx scripts/hermes/evaluate-news.ts --batch [--daily-cap 5]
 *   npx tsx scripts/hermes/evaluate-news.ts --id 42
 *
 * Exit codes: 0 = success, 1 = fatal error
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, isNotNull, inArray, gte, desc } from "drizzle-orm";

const FETCH_TIMEOUT_MS = 20_000;
const UA = "science-agent/2.0 (+https://159.194.236.68:3000)";

const SCORE_GATE = 75; // strictly greater passes
const GH_MAJOR_STARS = 10_000; // "major project" threshold for fresh releases
const RELEASE_MAX_AGE_MS = 72 * 3600_000; // fresh release window
const SOCIAL_THRESHOLD = 100;
const ALTMETRIC_THRESHOLD = 50;

const TIER1_SOURCES = new Set(["nature", "science", "lancet", "cell"]);
const TIER1_LAB_BLOGS = new Set([
  "openai-blog",
  "anthropic-blog",
  "google-ai-blog",
  "deepmind-blog",
]);
const OPEN_LICENSES = new Set(["MIT", "Apache-2.0"]);

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

/** Extract outbound links + DOIs from the article page (light cheerio pass). */
async function extractPageSignals(url: string): Promise<{ links: string[]; dois: string[] }> {
  const res = await safeFetch(url);
  if (!res) return { links: [], dois: [] };
  let html = "";
  try {
    html = await res.text();
  } catch {
    return { links: [], dois: [] };
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
  return { links: [...links], dois: [...dois].slice(0, 5) };
}

interface GhInfo {
  stars: number;
  license: string | null;
}

async function githubRepoInfo(fullName: string): Promise<GhInfo | null> {
  const data = await fetchJson<{
    stargazers_count?: number;
    license?: { spdx_id?: string } | null;
  }>(`https://api.github.com/repos/${fullName}`);
  if (!data || typeof data.stargazers_count !== "number") return null;
  return { stars: data.stargazers_count, license: data.license?.spdx_id ?? null };
}

/** Latest GitHub release younger than 72h (velocity signal for major projects). */
async function githubFreshRelease(
  fullName: string,
): Promise<{ tag: string; publishedAt: string } | null> {
  const rel = await fetchJson<{ tag_name?: string; published_at?: string }[]>(
    `https://api.github.com/repos/${fullName}/releases?per_page=1`,
  );
  const latest = rel?.[0];
  if (
    latest?.published_at &&
    Date.now() - new Date(latest.published_at).getTime() <= RELEASE_MAX_AGE_MS
  ) {
    return { tag: latest.tag_name ?? "release", publishedAt: latest.published_at };
  }
  return null;
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

/** Evaluate one article: collect hard metrics and sum points deterministically. */
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

  // Pre-collected metrics from collector APIs (GitHub / HN / Reddit)
  let githubStars = typeof prev.githubStars === "number" ? prev.githubStars : null;
  let githubLicense = typeof prev.githubLicense === "string" ? prev.githubLicense : null;
  let hnPoints = typeof prev.hnPoints === "number" ? prev.hnPoints : null;
  let redditUpsN = typeof prev.redditUps === "number" ? prev.redditUps : null;
  let hasOpenArtifact = false;

  // Page-level signals: outbound links, DOIs (skip for API-sourced GitHub items)
  const isGithubUrl = /github\.com\/[\w.-]+\/[\w.-]+/.test(article.originalUrl);
  let links: string[] = [];
  let dois: string[] = [];
  if (!isGithubUrl) {
    const signals = await extractPageSignals(article.originalUrl);
    links = signals.links;
    dois = signals.dois;
  }

  // GitHub stars/license — from URL itself or first github link in content
  let ghFullName: string | null = null;
  if (githubStars === null) {
    const ghLink = isGithubUrl
      ? article.originalUrl
      : links.find((l) => /github\.com\/[\w.-]+\/[\w.-]+/.test(l));
    if (ghLink) {
      const m = ghLink.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
      if (m && !["topics", "trending", "collections", "features"].includes(m[1])) {
        ghFullName = `${m[1]}/${m[2]}`;
        hasOpenArtifact = true;
        const info = await githubRepoInfo(ghFullName);
        if (info) {
          githubStars = info.stars;
          githubLicense = info.license;
        }
      }
    }
  } else {
    hasOpenArtifact = true;
    const m = article.originalUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
    if (m) ghFullName = `${m[1]}/${m[2]}`;
  }
  if (!hasOpenArtifact) {
    hasOpenArtifact = links.some(
      (l) => /huggingface\.co\/(models|datasets)\//.test(l) || /zenodo\.org|kaggle\.com\/datasets/.test(l),
    );
  }

  // Social traction — only query APIs if collector didn't supply numbers
  if (hnPoints === null) hnPoints = await hackerNewsPoints(article.originalUrl, article.title);
  if (redditUpsN === null) redditUpsN = await redditUps(article.originalUrl);

  // Altmetric (science articles with DOI)
  let altmetric: number | null = null;
  if (article.isScience) {
    const doiFromUrl = article.originalUrl.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    const doi = doiFromUrl ? doiFromUrl[0] : dois[0];
    if (doi) altmetric = await altmetricScore(doi);
  }

  metrics.githubStars = githubStars;
  metrics.githubLicense = githubLicense;
  metrics.githubRepo = ghFullName;
  metrics.hnPoints = hnPoints;
  metrics.redditUps = redditUpsN;
  metrics.altmetricScore = altmetric;
  metrics.hasOpenArtifact = hasOpenArtifact;
  metrics.dois = dois;

  // ── Sum points deterministically ──
  let score = 0;

  if (article.isScience) {
    // Science criteria
    if (TIER1_SOURCES.has(article.source) || TIER1_LAB_BLOGS.has(article.source)) {
      score += 50;
      breakdown.push({
        criterion: "tier1-journal-or-lab",
        points: 50,
        evidence: `source=${article.source}`,
      });
    }
    const isArxiv = /arxiv\.org/.test(article.originalUrl) || article.source === "arxiv";
    if (isArxiv && hasOpenArtifact) {
      score += 40;
      breakdown.push({
        criterion: "arxiv-with-open-artifact",
        points: 40,
        evidence: `openArtifact=${hasOpenArtifact}, githubStars=${githubStars ?? "n/a"}`,
      });
    }
    if (altmetric !== null && altmetric >= ALTMETRIC_THRESHOLD) {
      score += 30;
      breakdown.push({
        criterion: "altmetric-buzz",
        points: 30,
        evidence: `altmetric=${altmetric}`,
      });
    }
  } else {
    // Tech criteria — VELOCITY paradigm:
    // (a) project surfaced by our GitHub Trending collector (fresh repo gaining stars)
    const isTrending = prev.origin === "github-api" && isGithubUrl;
    // (b) major project (>10k stars) with a fresh release/tag <= 72h
    let freshRelease: { tag: string; publishedAt: string } | null = null;
    if (
      !isTrending &&
      ghFullName &&
      githubStars !== null &&
      githubStars > GH_MAJOR_STARS
    ) {
      freshRelease = await githubFreshRelease(ghFullName);
    }
    metrics.githubTrending = isTrending;
    metrics.githubFreshRelease = freshRelease;

    if (isTrending || freshRelease) {
      score += 40;
      breakdown.push({
        criterion: isTrending ? "github-trending-velocity" : "github-fresh-release",
        points: 40,
        evidence: isTrending
          ? `repo=${ghFullName ?? article.originalUrl}, stars=${githubStars ?? "n/a"} (trending)`
          : `repo=${ghFullName}, stars=${githubStars}, release=${freshRelease!.tag} @ ${freshRelease!.publishedAt}`,
      });
    }
    if ((hnPoints ?? 0) > SOCIAL_THRESHOLD || (redditUpsN ?? 0) > SOCIAL_THRESHOLD) {
      score += 30;
      breakdown.push({
        criterion: "social-traction-100",
        points: 30,
        evidence: `hnPoints=${hnPoints ?? 0}, redditUps=${redditUpsN ?? 0}`,
      });
    }
    if (githubLicense && OPEN_LICENSES.has(githubLicense)) {
      score += 20;
      breakdown.push({
        criterion: "open-license",
        points: 20,
        evidence: `license=${githubLicense}`,
      });
    }
  }

  return { id: article.id, title: article.title, score, breakdown, metrics };
}

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
      results.push({ id: t.id, title: t.title, score: 0, breakdown: [], metrics: { evalError: (err as Error).message.slice(0, 200) } });
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
      await db
        .update(news)
        .set({ score: r.score, metrics, updatedAt: new Date() })
        .where(eq(news.id, r.id));
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
