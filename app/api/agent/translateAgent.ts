import { getDb } from "../queries/connection";
import { news } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { getAgentState, updateAgentState } from "./state";
import { logger } from "../lib/logger";
import { translateArticle } from "../ai/client";

const DEFAULT_BATCH_SIZE = 30;
const DELAY_BETWEEN_ARTICLES_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTranslateAgent(limit?: number): Promise<{
  translated: number;
  errors: string[];
}> {
  const batchSize = limit || DEFAULT_BATCH_SIZE;
  const state = getAgentState("translate-agent");

  if (state.status === "running") {
    logger.warn("Translate Agent: already running, skipping");
    return { translated: 0, errors: [] };
  }

  updateAgentState("translate-agent", {
    status: "running",
    lastRun: new Date(),
    runCount: state.runCount + 1,
  });

  const errors: string[] = [];
  let translated = 0;

  try {
    const db = getDb();
    const untranslated = await db
      .select()
      .from(news)
      .where(eq(news.status, "summarized"))
      .orderBy(desc(news.publishedAt))
      .limit(batchSize);

    if (untranslated.length === 0) {
      logger.info("Translate Agent: no articles to translate");
      updateAgentState("translate-agent", { status: "idle" });
      return { translated: 0, errors: [] };
    }

    logger.info("Translate Agent: found articles", { count: untranslated.length });

    for (const article of untranslated) {
      try {
        const startTime = Date.now();

        if (article.language === "ru") {
          const russianText = article.originalContent || article.content || article.summary;
          await db
            .update(news)
            .set({ translation: russianText, status: "translated", updatedAt: new Date() })
            .where(eq(news.id, article.id));
          translated++;
          logger.info("Translate Agent: Russian article, skip", { id: article.id });
          continue;
        }

        const fullText = article.originalContent || article.content || article.summary;
        const [translation, translatedTitle] = await Promise.all([
          translateArticle(article.title, fullText, article.source),
          translateArticle(article.title, article.title, article.source),
        ]);

        await db
          .update(news)
          .set({
            title: translatedTitle,
            translation,
            status: "translated",
            updatedAt: new Date(),
          })
          .where(eq(news.id, article.id));

        translated++;
        const duration = Date.now() - startTime;
        logger.info("Translate Agent: done", {
          id: article.id,
          title: translatedTitle.substring(0, 50),
          duration: `${duration}ms`,
        });

        if (translated < untranslated.length) {
          await sleep(DELAY_BETWEEN_ARTICLES_MS);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Article ${article.id}: ${msg}`);
        logger.error("Translate Agent: failed", { id: article.id, error: msg });
      }
    }

    updateAgentState("translate-agent", {
      status: "idle",
      successCount: state.successCount + translated,
    });
  } catch (error) {
    updateAgentState("translate-agent", {
      status: "error",
      lastError: error instanceof Error ? error.message : String(error),
    });
    logger.error("Translate Agent: fatal error", { error: String(error) });
  }

  return { translated, errors };
}
