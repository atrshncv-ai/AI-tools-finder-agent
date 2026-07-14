/**
 * dedup.ts — Semantic Deduplication Guard (shared module for Hermes CLI scripts).
 *
 * Two-stage protection against duplicate news BEFORE scoring/summarization:
 *   1. Exact URL match against the DB (fast path).
 *   2. Semantic "same story" guard: normalized Levenshtein similarity of the
 *      candidate title against the last N titles in the DB (default 20).
 *      Threshold 0.85 — e.g. «OpenAI выпустила GPT-5.6» from different media
 *      outlets collapses into a single story.
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
  const lookback = opts.lookback ?? 20;
  const db = getDb();
  const recent = await db
    .select({ id: news.id, title: news.title })
    .from(news)
    .orderBy(desc(news.createdAt))
    .limit(lookback);

  const norm = normalizeTitle(title);
  if (!norm) return null;

  let best: DuplicateMatch | null = null;
  for (const row of recent) {
    const sim = similarity(norm, normalizeTitle(row.title));
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { id: row.id, title: row.title, similarity: sim };
    }
  }
  return best;
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
