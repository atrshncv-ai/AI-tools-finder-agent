import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { runParseAgent } from "./api/agent/parseAgent";
import { runSummarizeAgent } from "./api/agent/summarizeAgent";
import { runTranslateAgent } from "./api/agent/translateAgent";
import { runDeployAgent } from "./api/agent/deployAgent";
import { getDb } from "./api/queries/connection";

const TEST_LIMIT = 30;

function formatTime(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(0);
  return `${m}m ${sec}s`;
}

async function main() {
  const startTime = Date.now();
  const db = getDb();

  console.log("=".repeat(60));
  console.log(`ПОЛНЫЙ ЦИКЛ НА ${TEST_LIMIT} СТАТЬЯХ`);
  console.log("=".repeat(60));
  console.log(`Модель саммари: ${process.env.LM_STUDIO_MODEL}`);
  console.log(`Модель перевода: Google Translate`);
  console.log();

  // Stage 1: Parse
  const parseStart = Date.now();
  console.log("[1/4] ПАРСИНГ...");
  const parseResults = await runParseAgent();
  const totalNew = parseResults.reduce((sum, r) => sum + r.articlesNew, 0);
  const parseTime = Date.now() - parseStart;
  console.log(`  Новых статей: ${totalNew}`);
  console.log(`  Время: ${formatTime(parseTime)}`);
  console.log();

  // Stage 2: Summarize
  const sumStart = Date.now();
  console.log(`[2/4] САММАРИ (gemma-4-e4b, лимит ${TEST_LIMIT})...`);
  const summarizeResult = await runSummarizeAgent(TEST_LIMIT);
  const sumTime = Date.now() - sumStart;
  console.log(`  Просуммаризовано: ${summarizeResult.summarized}`);
  console.log(`  Время: ${formatTime(sumTime)}`);
  if (summarizeResult.summarized > 0) {
    console.log(`  Среднее: ${(sumTime / 1000 / summarizeResult.summarized).toFixed(1)}s/статью`);
  }
  console.log();

  // Stage 3: Translate
  const transStart = Date.now();
  console.log(`[3/4] ПЕРЕВОД (Google Translate, лимит ${TEST_LIMIT})...`);
  const translateResult = await runTranslateAgent(TEST_LIMIT);
  const transTime = Date.now() - transStart;
  console.log(`  Переведено: ${translateResult.translated}`);
  console.log(`  Время: ${formatTime(transTime)}`);
  if (translateResult.translated > 0) {
    console.log(`  Среднее: ${(transTime / 1000 / translateResult.translated).toFixed(1)}s/статью`);
  }
  console.log();

  // Stage 4: Publish
  const pubStart = Date.now();
  console.log("[4/4] ПУБЛИКАЦИЯ...");
  const deployResult = await runDeployAgent();
  const pubTime = Date.now() - pubStart;
  console.log(`  Опубликовано: ${deployResult.deployed}`);
  console.log(`  Время: ${formatTime(pubTime)}`);
  console.log();

  // Mark with model
  await db.execute(
    `UPDATE news SET "modelUsed" = 'google/gemma-4-e4b (test)' WHERE status = 'published' AND "modelUsed" IS NULL`
  );

  // Summary
  const totalTime = Date.now() - startTime;
  console.log("=".repeat(60));
  console.log("ИТОГИ");
  console.log("=".repeat(60));
  console.log(`  Парсинг:    ${formatTime(parseTime)}`);
  console.log(`  Саммари:    ${formatTime(sumTime)} (${summarizeResult.summarized} статей)`);
  console.log(`  Перевод:    ${formatTime(transTime)} (${translateResult.translated} статей)`);
  console.log(`  Публикация: ${formatTime(pubTime)}`);
  console.log(`  ─────────────────────────`);
  console.log(`  ОБЩЕЕ:      ${formatTime(totalTime)}`);
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Критическая ошибка:", error);
  process.exit(1);
});
