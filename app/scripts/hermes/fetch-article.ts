#!/usr/bin/env tsx
/**
 * fetch-article.ts — Fetches and cleans article HTML, outputs plain text to stdout.
 *
 * Usage:
 *   npx tsx scripts/hermes/fetch-article.ts --url <article_url>
 *
 * Downloads the article, strips noise (scripts, nav, footer, ads), extracts the
 * main content, and prints clean text to stdout. Hermes can pipe this to Zen API.
 * Exits with code 0 on success, 1 on error.
 */

import { isYoutubeUrl, fetchYoutubeTranscript } from "./youtube-transcript";
import { ssrfCheck } from "../../api/lib/url-safety";
import { extractArticleText } from "./article-content";

function parseArgs(): { url: string | null } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" || args[i] === "-u") {
      return { url: args[++i] || null };
    }
  }
  return { url: null };
}

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function main() {
  const { url } = parseArgs();

  if (!url) {
    console.error("[fetch-article] --url is required");
    console.error("\nUsage: npx tsx scripts/hermes/fetch-article.ts --url <article_url>");
    process.exit(1);
  }

  console.error(`[fetch-article] Fetching: ${url}`);

  // SSRF guard: article URLs come from the DB/feeds — block private ranges.
  const blocked = ssrfCheck(url);
  if (blocked) {
    console.error(`[fetch-article] SSRF guard: ${url} (${blocked})`);
    return null;
  }

  // YouTube branch: transcript via yt-dlp instead of HTML scraping.
  if (isYoutubeUrl(url)) {
    const t = await fetchYoutubeTranscript(url);
    if (!t) {
      console.error("[fetch-article] YouTube transcript unavailable");
      process.exit(1);
    }
    const text = normalizeSpace(
      `${t.title}. ${t.description}\n\nTranscript (${t.kind}, ${t.lang}):\n${t.text}`,
    );
    process.stdout.write(text);
    console.error(`[fetch-article] Done: ${text.length} chars (youtube transcript)`);
    process.exit(0);
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ScienceAgent/1.0)" },
      signal: AbortSignal.timeout(20000),
    });

    // Skip error pages (403 Cloudflare stubs, 404, 5xx) — never feed them to the LLM.
    if (!res.ok) {
      console.error(`[fetch-article] HTTP ${res.status} for ${url}`);
      return null;
    }

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "";
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
    const charset = charsetMatch?.[1]?.toLowerCase() || "utf-8";
    const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
    const html = decoder.decode(buffer);

    const text = extractArticleText(html, url);

    if (text.length < 100) {
      console.error("[fetch-article] Extracted text too short (<100 chars)");
      process.exit(1);
    }

    // Output clean text to stdout (Hermes can pipe this)
    process.stdout.write(text);
    console.error(`[fetch-article] Done: ${text.length} chars`);
    process.exit(0);
  } catch (err) {
    console.error("[fetch-article] Fetch failed:", err);
    process.exit(1);
  }
}

main();
