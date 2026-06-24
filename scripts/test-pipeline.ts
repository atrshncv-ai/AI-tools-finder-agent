import { config } from "dotenv";
import { resolve } from "path";
import { getDb } from "../app/api/queries/connection";
import { news } from "../app/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { runParseAgent } from "../app/api/agent/parseAgent";
import { runSummarizeAgent } from "../app/api/agent/summarizeAgent";
import { runTranslateAgent } from "../app/api/agent/translateAgent";

config({ path: resolve(__dirname, "../.env") });

const TEST_LIMIT = 5;

async function main() {
  console.log("=== Тест пайплайна на 5 статьях ===\n");

  // Stage 1: Parsing
  console.log("[1/3] Парсинг статей...");
  const parseResults = await runParseAgent();
  const totalNew = parseResults.reduce((sum, r) => sum + r.articlesNew, 0);
  console.log(`  Найдено новых статей: ${totalNew}`);

  if (totalNew === 0) {
    console.log("\nНет новых статей для обработки.");
    return;
  }

  // Stage 2: Summarization
  console.log("\n[2/3] Суммаризация статей (по 1 за раз)...");
  const summarizeResult = await runSummarizeAgent();
  console.log(`  Просуммаризовано: ${summarizeResult.summarized}`);
  if (summarizeResult.errors.length > 0) {
    console.log(`  Ошибки: ${summarizeResult.errors.join(", ")}`);
  }

  // Stage 3: Translation
  console.log("\n[3/3] Перевод статей (по 1 за раз)...");
  const translateResult = await runTranslateAgent();
  console.log(`  Переведено: ${translateResult.translated}`);
  if (translateResult.errors.length > 0) {
    console.log(`  Ошибки: ${translateResult.errors.join(", ")}`);
  }

  console.log("\n=== Тест завершён ===");
  process.exit(0);
}

main().catch((error) => {
  console.error("Ошибка:", error);
  process.exit(1);
});
