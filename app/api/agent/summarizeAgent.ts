import * as cheerio from "cheerio";
import { getDb } from "../queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getAgentState, updateAgentState } from "./state";
import { summarizeArticle, checkLmStudioConnection } from "../ai/client";
import { summarizeWithGigaChat } from "../ai/gigachatTranslate";
import { logger } from "../lib/logger";

const DEFAULT_BATCH_SIZE = 30;

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
    $("script, style, nav, header, footer, aside, iframe, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
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

  const useGigaChat = process.env.SUMMARY_PROVIDER === "gigachat";

  if (!useGigaChat) {
    const lmStudioOk = await checkLmStudioConnection();
    if (!lmStudioOk) {
      logger.warn("Summarize Agent: LM Studio not available");
      return { summarized: 0, errors: ["LM Studio is not available"] };
    }
    logger.info("Summarize Agent: using LM Studio", { model: process.env.LM_STUDIO_MODEL });
  } else {
    logger.info("Summarize Agent: using GigaChat", { model: process.env.GIGACHAT_MODEL || "GigaChat" });
  }

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

        const { summary, detailedSummary } = useGigaChat
          ? await summarizeWithGigaChat(article.title, text, article.source)
          : await summarizeArticle(article.title, text, article.source);

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
