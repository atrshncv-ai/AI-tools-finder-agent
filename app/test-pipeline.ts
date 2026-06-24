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
  console.log(`=== Тест саммари + перевод на ${TEST_LIMIT} статьях (qwen/qwen3.5-9b) ===\n`);

  const db = getDb();

  // Check available articles
  const pending = await db
    .select()
    .from(news)
    .where(and(eq(news.status, "pending"), isNull(news.content)))
    .orderBy(desc(news.publishedAt))
    .limit(TEST_LIMIT);

  console.log(`Статей для саммари: ${pending.length}`);
  for (const a of pending) {
    console.log(`  [${a.id}] ${a.title.substring(0, 80)}...`);
  }
  console.log();

  // Stage 1: Summarization
  console.log(`[1/2] Суммаризация (по 1 за раз, лимит ${TEST_LIMIT})...`);
  const t1 = Date.now();
  const summarizeResult = await runSummarizeAgent(TEST_LIMIT);
  const elapsed1 = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`  Просуммаризовано: ${summarizeResult.summarized} за ${elapsed1}s`);
  if (summarizeResult.errors.length > 0) {
    console.log(`  Ошибки:`);
    for (const e of summarizeResult.errors) {
      console.log(`    ${e}`);
    }
  }
  console.log();

  // Stage 2: Translation
  console.log(`[2/2] Перевод (по 1 за раз, лимит ${TEST_LIMIT})...`);
  const t2 = Date.now();
  const translateResult = await runTranslateAgent(TEST_LIMIT);
  const elapsed2 = ((Date.now() - t2) / 1000).toFixed(1);
  console.log(`  Переведено: ${translateResult.translated} за ${elapsed2}s`);
  if (translateResult.errors.length > 0) {
    console.log(`  Ошибки:`);
    for (const e of translateResult.errors) {
      console.log(`    ${e}`);
    }
  }
  console.log();

  // Show results
  console.log("=== Результаты ===");
  const processed = await db
    .select()
    .from(news)
    .where(eq(news.status, "translated"))
    .orderBy(desc(news.updatedAt))
    .limit(TEST_LIMIT);

  for (const a of processed) {
    console.log(`\n[${a.id}] ${a.title.substring(0, 80)}`);
    console.log(`  Саммари: ${(a.summary || "").substring(0, 150)}...`);
    console.log(`  Перевод: ${(a.translation || "").substring(0, 150)}...`);
  }

  console.log(`\n=== Готово: ${summarizeResult.summarized} саммари, ${translateResult.translated} переводов ===`);
}

main().catch((error) => {
  console.error("Критическая ошибка:", error);
  process.exit(1);
});
