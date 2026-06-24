import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { runSummarizeAgent } from "./api/agent/summarizeAgent";
import { runTranslateAgent } from "./api/agent/translateAgent";
import { getDb } from "./api/queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

const TEST_LIMIT = 5;

async function main() {
  console.log(`=== Тест gemma-4-e4b на ${TEST_LIMIT} статьях ===\n`);

  const db = getDb();

  const pending = await db
    .select()
    .from(news)
    .where(and(eq(news.status, "pending"), isNull(news.content)))
    .orderBy(desc(news.publishedAt))
    .limit(TEST_LIMIT);

  console.log(`Статей для саммари: ${pending.length}`);
  for (const a of pending) {
    console.log(`  [${a.id}] ${a.title.substring(0, 60)}...`);
  }
  console.log();

  // Stage 1: Summarization
  console.log("[1/2] Саммари (gemma-4-e4b)...");
  const t1 = Date.now();
  const summarizeResult = await runSummarizeAgent(TEST_LIMIT);
  const elapsed1 = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`  Просуммаризовано: ${summarizeResult.summarized} за ${elapsed1}s`);
  console.log(`  Среднее: ${(parseFloat(elapsed1) / summarizeResult.summarized).toFixed(1)}s/статью`);
  if (summarizeResult.errors.length > 0) {
    console.log(`  Ошибки: ${summarizeResult.errors.length}`);
  }
  console.log();

  // Stage 2: Translation
  console.log("[2/2] Перевод (Google Translate)...");
  const t2 = Date.now();
  const translateResult = await runTranslateAgent(TEST_LIMIT);
  const elapsed2 = ((Date.now() - t2) / 1000).toFixed(1);
  console.log(`  Переведено: ${translateResult.translated} за ${elapsed2}s`);
  console.log(`  Среднее: ${(parseFloat(elapsed2) / translateResult.translated).toFixed(1)}s/статью`);
  console.log();

  // Summary
  const totalTime = ((Date.now() - t1) / 1000).toFixed(1);
  console.log("=== Итого ===");
  console.log(`  Саммари: ${summarizeResult.summarized} статей`);
  console.log(`  Перевод: ${translateResult.translated} статей`);
  console.log(`  Общее время: ${totalTime}s`);
  console.log(`  Средняя скорость: ${(parseFloat(totalTime) / (summarizeResult.summarized || 1)).toFixed(1)}s/статью`);
}

main().catch((error) => {
  console.error("Ошибка:", error);
  process.exit(1);
});
