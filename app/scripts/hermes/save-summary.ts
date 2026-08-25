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
import { isGarbageText, isUnusableExtractedContent } from "./content-quality";
import { resolveSection } from "../../api/lib/section-resolve";

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ─── HTML fetch + clean ──────────────────────────────────────────────────────

// Browser-like UA chain: the first UA passes most anti-bot walls (same as
// collect-dual RSS_UA); the Firefox retry catches per-UA blocks. A generic
// "ScienceAgent/1.0" UA was the reason ~4 articles/cycle died on Cloudflare.
const FETCH_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
];

async function fetchAndCleanArticle(url: string): Promise<{ text: string; attempt: number } | null> {
  // SSRF guard: originalUrl comes from the DB — block private ranges.
  const blocked = ssrfCheck(url);
  if (blocked) {
    console.error(`[save-summary] SSRF guard: ${url} (${blocked})`);
    return null;
  }
  for (let attempt = 0; attempt < FETCH_UAS.length; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": FETCH_UAS[attempt],
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        },
        signal: AbortSignal.timeout(20000),
      });
      // Skip error pages (403 Cloudflare stubs, 404, 5xx) — never feed them to the LLM.
      if (!res.ok) {
        console.error(`[save-summary] HTTP ${res.status} (ua#${attempt + 1}) for ${url}`);
        continue;
      }
      const buffer = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || "";
      const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
      const charset = charsetMatch?.[1]?.toLowerCase() || "utf-8";
      const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
      const html = decoder.decode(buffer);
      const text = extractArticleText(html, url);
      if (text.length > 100) return { text, attempt };
      console.error(`[save-summary] extracted ${text.length} chars (ua#${attempt + 1}) — below threshold`);
    } catch (err) {
      console.error(`[save-summary] fetch failed (ua#${attempt + 1}): ${(err as Error).message.slice(0, 100)}`);
    }
  }
  return null;
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
  let fetchFallbackInfo: Record<string, unknown> | null = null;
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
      const fetched = await fetchAndCleanArticle(article.originalUrl);
      if (!fetched) {
        console.error("[save-summary] Failed to fetch or extract article content");
        process.exit(1);
      }
      text = fetched.text;
      if (fetched.attempt > 0) {
        fetchFallbackInfo = { attempts: fetched.attempt + 1, ua: "firefox-retry", at: new Date().toISOString() };
        console.error(`[save-summary] fetched via fallback ua#${fetched.attempt + 1}`);
      }
    }
    const contentKind = isYoutubeUrl(article.originalUrl) ? "youtube-transcript" : "web-article";
    if (isUnusableExtractedContent(text, contentKind)) {
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
  if (fetchFallbackInfo) {
    updateData.metrics = { ...((article.metrics as Record<string, unknown>) || {}), fetchFallback: fetchFallbackInfo };
  }

  // Final unified re-routing with the richest context available (Russian
  // title + generated summary + extracted content). Bidirectional: an article
  // misrouted on sparse collection input moves to its real section here.
  const resolution = resolveSection({
    title: (titleRu || article.title || "").trim(),
    description: (summary || "").trim(),
    content: (originalContent || detailedSummary || "").trim(),
  });
  const currentSection = article.section || "ai-news";
  if (resolution.section !== currentSection) {
    updateData.section = resolution.section;
    console.error(`[save-summary] Reassigning #${args.id} ${currentSection} -> ${resolution.section}`);
  }
  updateData.sphereTags = resolution.sphereTags;
  updateData.isScience = resolution.isScience;
  updateData.scienceField = resolution.scienceField;

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
