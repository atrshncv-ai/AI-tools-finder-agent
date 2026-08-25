/**
 * dedup.ts — Semantic Deduplication Guard (shared module for Hermes CLI scripts).
 *
 * Two-stage protection against duplicate news BEFORE scoring/summarization:
 *   1. Exact URL match against the DB (fast path).
 *   2. Semantic "same story" guard against the last N titles in the DB:
 *      a) normalized Levenshtein similarity >= threshold (0.85);
 *      b) versioned-entity rule: two titles sharing a versioned model/entity
 *         name («gpt-5.6», «claude-4», «gemini-3.7») with similarity >= 0.4.
 *      One story reported by different outlets in different words collapses
 *      into a single card; brand-only overlap («OpenAI» in both) is NOT
 *      enough — different news about the same company must stay.
 */

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, desc } from "drizzle-orm";

/** Normalize a title for comparison: lowercase, strip punctuation & stop-words. */
export function normalizeTitle(title: string): string {
  const STOP = new Set([
    "the", "a", "an", "of", "in", "on", "for", "to", "and", "with", "by", "is", "are",
    "new", "news", "this", "that", "how", "why", "what",
    "и", "в", "на", "с", "по", "для", "как", "что", "это", "из", "у", "о", "от", "за",
  ]);
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(" ")
    .trim();
}

/**
 * Versioned entities: tokens that name a specific model/release — letters
 * AND digits in one token («gpt-5.6», «claude-4», «ios-26»). Bare numbers
 * («110 лет») and bare brands («OpenAI») deliberately excluded: brand-only
 * overlap must not merge different stories.
 */
const VERSIONED_ENTITY_RE = /^(?=[a-zа-яё\d._-]*[a-zа-яё])(?=[a-zа-яё\d._-]*\d)[a-zа-яё\d][a-zа-яё\d._-]*$/i;

export function extractVersionedEntities(title: string): Set<string> {
  const entities = new Set<string>();
  for (const raw of title.split(/\s+/)) {
    const token = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (token.length >= 3 && VERSIONED_ENTITY_RE.test(token)) entities.add(token);
  }
  return entities;
}

/** Classic Levenshtein distance (iterative, O(n*m), titles are short). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Similarity ratio 0..1 (1 = identical) based on Levenshtein distance. */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Stage 1: exact URL already in DB? */
export async function urlExists(url: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: news.id })
    .from(news)
    .where(eq(news.originalUrl, url))
    .limit(1);
  return rows.length > 0;
}

export interface DuplicateMatch {
  id: number;
  title: string;
  similarity: number;
}

/**
 * Stage 2: semantic duplicate of the last `lookback` titles in DB.
 * Returns the best matching existing article if similarity >= threshold, else null.
 */
export async function findSemanticDuplicate(
  title: string,
  opts: { threshold?: number; lookback?: number } = {},
): Promise<DuplicateMatch | null> {
  const threshold = opts.threshold ?? 0.85;
  const lookback = opts.lookback ?? 300;
  const db = getDb();
  const recent = await db
    .select({ id: news.id, title: news.title, originalTitle: news.originalTitle })
    .from(news)
    .orderBy(desc(news.createdAt))
    .limit(lookback);

  const norm = normalizeTitle(title);
  if (!norm) return null;

  let best: DuplicateMatch | null = null;
  for (const row of recent) {
    const match = matchTitle(title, norm, row.originalTitle ?? row.title, threshold);
    if (match && (!best || match.similarity > best.similarity)) {
      best = { id: row.id, title: row.originalTitle ?? row.title, similarity: match.similarity };
    }
  }
  return best;
}

/**
 * Combined rule for one candidate/existing title pair:
 *   - plain similarity >= threshold, OR
 *   - shared versioned entity («gpt-5.6») with similarity >= 0.4.
 * Length-difference early exit keeps the 300-row scan cheap.
 */
export function matchTitle(
  candidateRaw: string,
  candidateNorm: string,
  existingRaw: string,
  threshold: number,
): { similarity: number; reason: string } | null {
  const existingNorm = normalizeTitle(existingRaw);
  const maxLen = Math.max(candidateNorm.length, existingNorm.length);
  if (maxLen === 0) return null;
  if (Math.abs(candidateNorm.length - existingNorm.length) / maxLen > 0.6) return null;

  const sim = similarity(candidateNorm, existingNorm);
  if (sim >= threshold) return { similarity: sim, reason: "title-similarity" };

  const candEnt = extractVersionedEntities(candidateRaw);
  if (candEnt.size > 0) {
    const existingEnt = extractVersionedEntities(existingRaw);
    let shared = false;
    for (const e of candEnt) if (existingEnt.has(e)) { shared = true; break; }
    if (shared && sim >= 0.4) return { similarity: sim, reason: "versioned-entity" };
  }
  return null;
}

/** Full guard: URL check first (cheap), then semantic title check. */
export async function isDuplicate(
  url: string,
  title: string,
  opts: { threshold?: number; lookback?: number } = {},
): Promise<{ duplicate: boolean; reason: string; match?: DuplicateMatch }> {
  if (await urlExists(url)) {
    return { duplicate: true, reason: "url-exists" };
  }
  const match = await findSemanticDuplicate(title, opts);
  if (match) {
    return { duplicate: true, reason: "semantic-title", match };
  }
  return { duplicate: false, reason: "unique" };
}
