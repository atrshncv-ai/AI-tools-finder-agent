import * as cheerio from "cheerio";
import { getDb } from "../queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getAgentState, updateAgentState } from "./state";
import { summarizeArticle, checkZenConnection } from "../ai/zenClient";
import { logger } from "../lib/logger";

const DEFAULT_BATCH_SIZE = 30;

const NOISE_SELECTORS = [
  "script",
  "style",
  "nav",
  "header",
  "footer",
  "aside",
  "iframe",
  "noscript",
  "svg",
  "canvas",
  "form",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "[hidden]",
  "#labstabs",
  ".labstabs",
  "#arxivlabs",
  ".arxivlabs",
  ".ltx_page_footer",
  ".ltx_page_header",
  ".ltx_notes",
  ".footer",
  "#footer",
  ".page-footer",
  ".site-footer",
  ".sidebar",
  "#sidebar",
  ".nav",
  ".navbar",
  ".navigation",
  ".menu",
  ".mobile-menu",
  ".comments",
  "#comments",
  ".advert",
  ".ads",
  ".ad",
  ".cookie-banner",
  ".cookies",
  ".social",
  ".share",
  "#disqus_thread",
  ".noprint",
  ".hidden",
  "#mw-navigation",
  ".printfooter",
];

const CONTENT_SELECTORS = [
  "article",
  "main",
  '[role="main"]',
  "#content-inner",
  ".content-inner",
  "#content",
  "#main",
  ".content",
  ".post",
  ".entry",
  ".abstract",
  ".ltx_document",
];

function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function removeRepeatedBlocks(text: string): string {
  const blocks = text
    .split(/\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
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
  const lower = text.toLowerCase();
  const arxivMatches = lower.match(/arXivLabs: experimental projects with community collaborators/g);
  if (arxivMatches && arxivMatches.length > 1) return true;

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

async function fetchAndCleanArticle(url: string): Promise<string | null> {
  try {
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

    // Drop any remaining small nodes that mention arXivLabs or similar footer phrases.
    $("body *").each((_, el) => {
      const $el = $(el);
      const txt = $el.text().trim();
      if (txt.length > 0 && txt.length < 300 && /arxivlabs/i.test(txt)) {
        $el.remove();
      }
    });

    let container: any = $("body");
    for (const selector of CONTENT_SELECTORS) {
      const el = $(selector).first();
      if (el.length && el.text().trim().length > 200) {
        container = el;
        break;
      }
    }

    const text = cleanExtractedText(container.text());
    return text.length > 100 ? text : null;
  } catch (e) {
    logger.error("Failed to fetch article for summarization", { url, error: String(e) });
    return null;
  }
}

export async function runSummarizeAgent(limit?: number, scienceOnly?: boolean): Promise<{
  summarized: number;
  errors: string[];
}> {
  const batchSize = limit || DEFAULT_BATCH_SIZE;
  const state = getAgentState("summarize-agent");

  if (state.status === "running") {
    logger.warn("Summarize Agent: already running, skipping");
    return { summarized: 0, errors: [] };
  }

  const zenOk = await checkZenConnection();
  if (!zenOk) {
    logger.warn("Summarize Agent: Zen API not available");
    return { summarized: 0, errors: ["Zen API is not available"] };
  }
  logger.info("Summarize Agent: using Zen API", { model: process.env.ZEN_MODEL });

  updateAgentState("summarize-agent", {
    status: "running",
    lastRun: new Date(),
    runCount: state.runCount + 1,
  });

  const errors: string[] = [];
  let summarized = 0;

  try {
    const db = getDb();
    const whereConditions = [eq(news.status, "pending"), isNull(news.content)];
    if (scienceOnly) {
      whereConditions.push(eq(news.isScience, true));
    }
    const unsummarized = await db
      .select()
      .from(news)
      .where(and(...whereConditions))
      .orderBy(desc(news.publishedAt))
      .limit(batchSize);

    if (unsummarized.length === 0) {
      logger.info("Summarize Agent: no articles to summarize");
      updateAgentState("summarize-agent", { status: "idle" });
      return { summarized: 0, errors: [] };
    }

    logger.info("Summarize Agent: found articles", { count: unsummarized.length });

    for (const article of unsummarized) {
      try {
        const startTime = Date.now();

        const text = await fetchAndCleanArticle(article.originalUrl);
        if (!text) {
          logger.warn("Summarize Agent: article too short or fetch failed", {
            id: article.id,
          });
          continue;
        }
        if (isGarbageText(text)) {
          logger.warn("Summarize Agent: cleaned article text looks like garbage", {
            id: article.id,
            url: article.originalUrl,
          });
          continue;
        }

        const { summary, detailedSummary } = await summarizeArticle(article.title, text, article.source);

        if (isGarbageText(summary) || isGarbageText(detailedSummary)) {
          throw new Error("Model returned unusable summary");
        }

        await db
          .update(news)
          .set({
            summary,
            content: detailedSummary,
            originalContent: text,
            status: "summarized",
            updatedAt: new Date(),
          })
          .where(eq(news.id, article.id));

        summarized++;
        const duration = Date.now() - startTime;

        logger.info("Summarize Agent: article summarized", {
          id: article.id,
          title: article.title.substring(0, 50),
          duration: `${duration}ms`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Article ${article.id}: ${msg}`);
        logger.error("Summarize Agent: article failed", {
          id: article.id,
          error: msg,
        });
      }
    }

    updateAgentState("summarize-agent", {
      status: "idle",
      successCount: state.successCount + summarized,
    });
  } catch (error) {
    updateAgentState("summarize-agent", {
      status: "error",
      lastError: error instanceof Error ? error.message : String(error),
    });
    logger.error("Summarize Agent: fatal error", { error: String(error) });
  }

  return { summarized, errors };
}
