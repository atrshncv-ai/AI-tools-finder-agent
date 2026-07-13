import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { getDb } from "./api/queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { summarizeArticle } from "./api/ai/zenClient";

async function main() {
  const db = getDb();

  console.log("=== Тест скорости google/gemma-4-e4b ===\n");

  const articles = await db
    .select()
    .from(news)
    .where(and(eq(news.status, "pending"), isNull(news.content)))
    .orderBy(desc(news.publishedAt))
    .limit(1);

  if (articles.length === 0) {
    console.log("Нет статей для теста");
    return;
  }

  const article = articles[0];
  console.log(`Статья: ${article.title.substring(0, 60)}...`);
  console.log(`Источник: ${article.source}\n`);

  console.log("Тестирую суммаризацию через LM Studio...\n");

  const start = Date.now();
  const result = await summarizeArticle(article.title, `Test content for summarization. This is a scientific article about artificial intelligence and machine learning.`, article.source);
  const elapsed = Date.now() - start;

  console.log(`Время: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);
  console.log(`\nСаммари: ${result.summary}`);
  console.log(`\nПодробное: ${result.detailedSummary.substring(0, 200)}...`);
}

main().catch(console.error);
