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

import * as cheerio from "cheerio";
import { isYoutubeUrl, fetchYoutubeTranscript } from "./youtube-transcript";
import { ssrfCheck } from "../../api/lib/url-safety";

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

    const $ = cheerio.load(html);

    // Remove noise elements
    $(NOISE_SELECTORS.join(", ")).remove();

    // Drop remaining small arXivLabs nodes
    $("body *").each((_, el) => {
      const $el = $(el);
      const txt = $el.text().trim();
      if (txt.length > 0 && txt.length < 300 && /arxivlabs/i.test(txt)) {
        $el.remove();
      }
    });

    // Find the best content container
    let container = $("body");
    for (const selector of CONTENT_SELECTORS) {
      const el = $(selector).first();
      if (el.length && el.text().trim().length > 200) {
        container = el;
        break;
      }
    }

    const text = cleanExtractedText(container.text());

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
