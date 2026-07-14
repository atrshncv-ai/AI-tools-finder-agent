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
import { summarizeArticle, checkZenConnection, countTokens, truncateToTokens } from "../../api/ai/zenClient";
import * as cheerio from "cheerio";

// ─── Noise selectors for HTML cleaning (shared with summarizeAgent) ──────────

const NOISE_SELECTORS = [
  "script", "style", "nav", "header", "footer", "aside", "iframe",
  "noscript", "svg", "canvas", "form", "button", "input", "textarea",
  "select", "label", "[hidden]",
  "#labstabs", ".labstabs", "#arxivlabs", ".arxivlabs",
  ".ltx_page_footer", ".ltx_page_header", ".ltx_notes",
  ".footer", "#footer", ".page-footer", ".site-footer",
  ".sidebar", "#sidebar", ".nav", ".navbar", ".navigation",
  ".menu", ".mobile-menu", ".comments", "#comments",
  ".advert", ".ads", ".ad", ".cookie-banner", ".cookies",
  ".social", ".share", "#disqus_thread", ".noprint", ".hidden",
  "#mw-navigation", ".printfooter",
];

const CONTENT_SELECTORS = [
  "article", "main", '[role="main"]',
  "#content-inner", ".content-inner", "#content", "#main",
  ".content", ".post", ".entry", ".abstract",
  ".ltx_document",
];

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function removeRepeatedBlocks(text: string): string {
  const blocks = text.split(/\n+/).map((b) => b.trim()).filter((b) => b.length > 0);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const block of blocks) {
    if (seen.has(block)) continue;
    seen.add(block);
    result.push(block);
  }
  return result.join(" ");
}

function cleanExtractedText(raw: string): string {
  let text = raw
    .replace(/arXivLabs: experimental projects with community collaborators/gi, " ")
    .replace(/\bDownload PDF\b/gi, " ")
    .replace(/\bHTML \(experimental\)\b/gi, " ");
  text = normalizeSpace(text);
  text = removeRepeatedBlocks(text);
  return normalizeSpace(text);
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
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ScienceAgent/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "";
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const charset = charsetMatch?.[1]?.toLowerCase() || "utf-8";
  const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
  const html = decoder.decode(buffer);
  const $ = cheerio.load(html);

  $(NOISE_SELECTORS.join(", ")).remove();

  $("body *").each((_, el) => {
    const $el = $(el);
    const txt = $el.text().trim();
    if (txt.length > 0 && txt.length < 300 && /arxivlabs/i.test(txt)) {
      $el.remove();
    }
  });

  let container = $("body");
  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector).first();
    if (el.length && el.text().trim().length > 200) {
      container = el;
      break;
    }
  }

  const text = cleanExtractedText(container.text());
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

    // Fetch and clean article content
    const text = await fetchAndCleanArticle(article.originalUrl);
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

    // Call Zen API
    const result = await summarizeArticle(article.title, text, article.source);
    summary = result.summary;
    detailedSummary = result.detailedSummary;

    if (isGarbageText(summary) || isGarbageText(detailedSummary)) {
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

  // Save to DB
  const updateData: Record<string, unknown> = {
    summary,
    content: detailedSummary,
    status: "summarized",
    updatedAt: new Date(),
  };
  if (modelUsed) updateData.modelUsed = modelUsed;
  if (originalContent) updateData.originalContent = originalContent;

  await db.update(news).set(updateData).where(eq(news.id, args.id!));

  console.log(JSON.stringify({
    status: "ok",
    articleId: args.id,
    summaryLength: summary.length,
    contentLength: detailedSummary.length,
    model: modelUsed,
  }));

  process.exit(0);
}

main().catch((err) => {
  console.error("[save-summary] Fatal error:", err);
  process.exit(1);
});
