import { getDb } from "../queries/connection";
import { news } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { getAgentState, updateAgentState } from "./state";
import { logger } from "../lib/logger";
import { execSync } from "child_process";

const DEFAULT_BATCH_SIZE = 30;
const DELAY_BETWEEN_ARTICLES_MS = 3000;
const MAX_CHARS_PER_CHUNK = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function translateViaBing(text: string): string {
  if (!text || text.trim().length === 0) return "";
  const truncated = text.substring(0, 4500);

  const pyScript = `
import sys, translators as ts
text = sys.stdin.read()
result = ts.translate_text(text, translator='bing', from_language='en', to_language='ru')
print(result, end='')
`.trim();

  const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
    input: truncated,
    timeout: 30000,
    encoding: "utf-8",
  });

  return result.trim();
}

function translateTitleViaBing(title: string): string {
  if (!title || title.trim().length === 0) return title;

  const pyScript = `
import sys, translators as ts
text = sys.stdin.read()
result = ts.translate_text(text, translator='bing', from_language='en', to_language='ru')
print(result, end='')
`.trim();

  try {
    const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
      input: title,
      timeout: 15000,
      encoding: "utf-8",
    });
    return result.trim();
  } catch {
    return title;
  }
}

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function translateTextChunked(text: string): string {
  if (!text || text.trim().length === 0) return "";
  const truncated = text.substring(0, 4500);
  const chunks = splitIntoChunks(truncated, MAX_CHARS_PER_CHUNK);
  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    try {
      const translated = translateViaBing(chunk);
      translatedChunks.push(translated);
    } catch {
      translatedChunks.push(chunk);
    }
  }

  return translatedChunks.join("\n\n");
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
        const translation = translateTextChunked(fullText);
        const translatedTitle = translateTitleViaBing(article.title);

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
