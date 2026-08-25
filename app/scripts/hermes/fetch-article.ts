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
    process.exit(1);
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
    // Browser-like UA chain (same rationale as save-summary): the generic
    // bot UA died on Cloudflare walls; Firefox retry catches per-UA blocks.
    const FETCH_UAS = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    ];
    let text = "";
    for (let attempt = 0; attempt < FETCH_UAS.length; attempt++) {
      const res = await fetch(url, {
        headers: {
          "User-Agent": FETCH_UAS[attempt],
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        console.error(`[fetch-article] HTTP ${res.status} (ua#${attempt + 1}) for ${url}`);
        continue;
      }
      const buffer = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || "";
      const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
      const charset = charsetMatch?.[1]?.toLowerCase() || "utf-8";
      const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
      const html = decoder.decode(buffer);
      text = extractArticleText(html, url);
      if (text.length >= 100) break;
      console.error(`[fetch-article] extracted ${text.length} chars (ua#${attempt + 1}) — trying next UA`);
    }

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
