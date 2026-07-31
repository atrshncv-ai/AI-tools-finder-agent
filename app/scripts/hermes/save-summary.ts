#!/usr/bin/env tsx
/**
 * save-summary.ts — Summarize an article via Zen API and save to DB.
 *
 * Usage (auto mode — full pipeline):
 *   npx tsx scripts/hermes/save-summary.ts --id <article_id> [--model <name>]
 *
 * Usage (manual mode — pass pre-computed results):
 *   npx tsx scripts/hermes/save-summary.ts --id <article_id> --summary <text> --content <text> [--model <name>]
 *
 * Auto mode: fetches article from DB, calls Zen API for summarization, saves result.
 * Manual mode: saves pre-computed summary and content directly.
 * Exits with code 0 on success, 1 on error.
 */

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";
import { summarizeOneShot, checkZenConnection } from "../../api/ai/zenClient";
import { isYoutubeUrl, fetchYoutubeTranscript } from "./youtube-transcript";
import { ssrfCheck } from "../../api/lib/url-safety";
import { extractArticleText } from "./article-content";

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isGarbageText(text: string): boolean {
  if (!text || text.trim().length < 40) return true;
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [, count] of counts) {
    if (count > 3) return true;
  }
  return false;
}

// ─── HTML fetch + clean ──────────────────────────────────────────────────────

async function fetchAndCleanArticle(url: string): Promise<string | null> {
  // SSRF guard: originalUrl comes from the DB — block private ranges.
  const blocked = ssrfCheck(url);
  if (blocked) {
    console.error(`[save-summary] SSRF guard: ${url} (${blocked})`);
    return null;
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ScienceAgent/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  // Skip error pages (403 Cloudflare stubs, 404, 5xx) — never feed them to the LLM.
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "";
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const charset = charsetMatch?.[1]?.toLowerCase() || "utf-8";
  const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
  const html = decoder.decode(buffer);
  const text = extractArticleText(html, url);
  return text.length > 100 ? text : null;
}

// ─── Args parsing ────────────────────────────────────────────────────────────

interface Args {
  id: number | null;
  summary: string | null;
  content: string | null;
  model: string | null;
  auto: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    id: null,
    summary: null,
    content: null,
    model: null,
    auto: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--id":
        result.id = parseInt(args[++i] || "", 10);
        break;
      case "--summary":
        result.summary = args[++i] || null;
        break;
      case "--content":
        result.content = args[++i] || null;
        break;
      case "--model":
        result.model = args[++i] || null;
        break;
      case "--auto":
        result.auto = true;
        break;
    }
  }

  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (!args.id || isNaN(args.id)) {
    console.error("[save-summary] --id is required and must be a number");
    console.error("\nUsage:");
    console.error("  npx tsx scripts/hermes/save-summary.ts --id <article_id> [--model <name>]");
    console.error("  npx tsx scripts/hermes/save-summary.ts --id <n> --summary <text> --content <text>");
    process.exit(1);
  }

  const db = getDb();
  const article = await db.query.news.findFirst({
    where: eq(news.id, args.id!),
  });

  if (!article) {
    console.error(`[save-summary] Article #${args.id} not found`);
    process.exit(1);
  }

  let summary: string;
  let titleRu: string | null = null;
  let detailedSummary: string;
  let originalContent: string | null = null;
  let modelUsed: string | null = args.model;

  if (args.auto) {
    // ── Auto mode: fetch → summarize via Zen → save ──
    console.error(`[save-summary] Auto mode: summarizing article #${args.id}...`);
    console.error(`[save-summary] Title: ${article.title.substring(0, 80)}`);

    const zenOk = await checkZenConnection();
    if (!zenOk) {
      console.error("[save-summary] Zen API is not available");
      process.exit(1);
    }

    // Fetch content: YouTube videos go through yt-dlp transcript extraction,
    // everything else through HTML fetch+clean.
    let text: string | null;
    if (article.originalContent && article.originalContent.length >= 100) {
      text = article.originalContent;
      console.error(`[save-summary] Reusing ${text.length} chars from transcript preflight`);
    } else if (isYoutubeUrl(article.originalUrl)) {
      const t = await fetchYoutubeTranscript(article.originalUrl);
      if (!t) {
        // Video unavailable or no captions — reject instead of retrying forever.
        console.error("[save-summary] YouTube transcript unavailable — marking rejected");
        await db
          .update(news)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(news.id, args.id!));
        console.log(JSON.stringify({ status: "rejected", articleId: args.id, reason: "youtube-transcript-unavailable" }));
        process.exit(0);
      }
      console.error(`[save-summary] YouTube transcript: ${t.text.length} chars (${t.kind}, ${t.lang}, channel=${t.channel})`);
      text = normalizeSpace(`${t.title}. ${t.description}\n\nTranscript:\n${t.text}`);
    } else {
      text = await fetchAndCleanArticle(article.originalUrl);
    }
    if (!text) {
      console.error("[save-summary] Failed to fetch or extract article content");
      process.exit(1);
    }
    if (isGarbageText(text)) {
      console.error("[save-summary] Extracted text looks like garbage, skipping");
      process.exit(1);
    }
    originalContent = text;
    console.error(`[save-summary] Fetched ${text.length} chars`);

    // Single Zen API call: Russian title + Russian summary (JSON)
    const result = await summarizeOneShot(article.title, text, article.source);
    summary = result.summary;
    titleRu = result.titleRu;
    detailedSummary = "";

    if (isGarbageText(summary) || isGarbageText(titleRu)) {
      console.error("[save-summary] Zen API returned unusable summary");
      process.exit(1);
    }

    modelUsed = modelUsed || process.env.ZEN_MODEL || "zen-default";
  } else {
    // ── Manual mode: use provided args ──
    if (!args.summary) {
      console.error("[save-summary] --summary is required (or use --auto)");
      process.exit(1);
    }
    if (!args.content) {
      console.error("[save-summary] --content is required (or use --auto)");
      process.exit(1);
    }
    summary = args.summary;
    detailedSummary = args.content;
  }

  // Save to DB (title + summary are already Russian — no translation step).
  // URL INTEGRITY: originalUrl is NEVER modified here — for YouTube finds it
  // always stays the video link; the LLM output can only touch title/summary.
  const updateData: Record<string, unknown> = {
    summary,
    status: "summarized",
    updatedAt: new Date(),
  };
  if (titleRu) {
    updateData.title = titleRu;
    // Preserve the untranslated title for dedup before overwriting `title`.
    if (!article.originalTitle) updateData.originalTitle = article.title;
  }
  if (!args.auto && detailedSummary) updateData.content = detailedSummary;
  if (modelUsed) updateData.modelUsed = modelUsed;
  if (originalContent) updateData.originalContent = originalContent;

  await db.update(news).set(updateData).where(eq(news.id, args.id!));

  console.log(JSON.stringify({
    status: "ok",
    articleId: args.id,
    titleRu,
    summaryLength: summary.length,
    model: modelUsed,
  }));

  process.exit(0);
}

main().catch((err) => {
  console.error("[save-summary] Fatal error:", err);
  process.exit(1);
});
