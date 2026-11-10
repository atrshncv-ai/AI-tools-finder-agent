/**
 * prefilter.ts — stage A of the two-stage selection: a cheap, deterministic
 * decision "is this candidate worth an expensive call at all?" (R18.1).
 *
 * Runs on title + lead only. No network, no tokens, no DB: the guard test
 * stubs `fetch` and proves it is never called. Duplicate detection needs
 * history (URLs/titles in the DB) and stays in collect-dual, where `isDuplicate`
 * already runs before a row is inserted.
 *
 * Stage A knows nothing about sections or science directions: relevance to a
 * topic is stage B (judge.ts). Its dictionaries and weights never leave this
 * module.
 */

import { hasExplicitAiSignal } from "../../api/lib/classify";
import { DEDICATED_AI_YOUTUBE_SOURCES } from "./youtube-sources";

export interface PrefilterInput {
  title: string;
  lead?: string | null;
  source?: string | null;
  publishedAt?: Date | string | null;
  isYoutube?: boolean;
}

export interface PrefilterResult {
  keep: boolean;
  score: number;
  reason: string;
  evidence: string;
}

/** Same 72h window as collect-dual's Time Guard. */
const MAX_AGE_MS = 72 * 3600_000;
/** RSS feeds occasionally publish a few hours "ahead"; more is a broken date. */
const CLOCK_SKEW_MS = 6 * 3600_000;

/**
 * Authority tiers. Deliberately the same outlets evaluate-news scores
 * (TIER1/TIER2_SCIENCE there); until ticket 03 rewires evaluation onto this
 * module the list is duplicated — keep the two in sync when adding a source.
 */
const TIER1_SOURCES = new Set([
  "nature",
  "science",
  "lancet",
  "cell",
  "openai-blog",
  "anthropic-blog",
  "google-ai-blog",
  "deepmind-blog",
]);

const TIER2_SOURCES = new Set([
  "mit-tech-review",
  "huggingface-blog",
  "arxiv",
  "arxiv-cs-ai",
  "arxiv-cs-et",
  "naked-science",
]);

const WEIGHT = {
  aiInTitle: 40,
  aiInLeadOnly: 25,
  tier1Source: 30,
  tier2Source: 20,
  curatedYoutube: 10,
  freshUnder6h: 15,
  freshUnder24h: 10,
  freshUnder72h: 5,
  richLead: 10,
  decentLead: 5,
} as const;

function parsePublishedAt(value: PrefilterInput["publishedAt"]): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function drop(reason: string, evidence: string): PrefilterResult {
  return { keep: false, score: 0, reason, evidence };
}

export function prefilterCandidate(
  input: PrefilterInput,
  options: { now?: Date } = {},
): PrefilterResult {
  const now = options.now ?? new Date();
  const title = (input.title ?? "").trim();
  const lead = (input.lead ?? "").trim();
  const source = (input.source ?? "").trim();

  if (!title) return drop("empty-title", "title is empty");

  const published = parsePublishedAt(input.publishedAt);
  if (!published) return drop("unknown-date", "publishedAt missing or unparseable");

  const ageMs = now.getTime() - published.getTime();
  if (ageMs < -CLOCK_SKEW_MS) return drop("unknown-date", `publishedAt is in the future by ${-ageMs}ms`);
  if (ageMs > MAX_AGE_MS) return drop("stale", `age=${(ageMs / 3600_000).toFixed(1)}h > 72h`);

  // Hard AI gate (owner mandate 2026-09-10): no explicit AI signal in title or
  // lead means there is nothing for the judge to confirm — never spend a call.
  const titleSignal = hasExplicitAiSignal(title);
  const leadSignal = hasExplicitAiSignal(lead);
  if (!titleSignal && !leadSignal) {
    return drop("no-ai-signal", "no explicit AI/ML term in title or lead");
  }

  let score = 0;
  const parts: string[] = [];

  if (titleSignal) {
    score += WEIGHT.aiInTitle;
    parts.push("ai=title");
  } else {
    score += WEIGHT.aiInLeadOnly;
    parts.push("ai=lead");
  }

  if (TIER1_SOURCES.has(source)) {
    score += WEIGHT.tier1Source;
    parts.push("source=tier1");
  } else if (TIER2_SOURCES.has(source)) {
    score += WEIGHT.tier2Source;
    parts.push("source=tier2");
  } else if (input.isYoutube && DEDICATED_AI_YOUTUBE_SOURCES.has(source)) {
    score += WEIGHT.curatedYoutube;
    parts.push("source=curated-youtube");
  } else {
    parts.push("source=other");
  }

  if (ageMs <= 6 * 3600_000) {
    score += WEIGHT.freshUnder6h;
    parts.push(`age=${(ageMs / 3600_000).toFixed(1)}h`);
  } else if (ageMs <= 24 * 3600_000) {
    score += WEIGHT.freshUnder24h;
    parts.push(`age=${(ageMs / 3600_000).toFixed(1)}h`);
  } else {
    score += WEIGHT.freshUnder72h;
    parts.push(`age=${(ageMs / 3600_000).toFixed(1)}h`);
  }

  if (lead.length >= 400) {
    score += WEIGHT.richLead;
  } else if (lead.length >= 150) {
    score += WEIGHT.decentLead;
  }
  parts.push(`lead=${lead.length}`);

  return { keep: true, score, reason: "keep", evidence: parts.join("; ") };
}
