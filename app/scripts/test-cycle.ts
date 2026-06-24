import "dotenv/config";

// Optimize LM Studio throughput for the test run without changing config files
process.env.LM_STUDIO_URL = "http://localhost:1234";
process.env.LM_STUDIO_MODEL = "google/gemma-4-e4b";
process.env.SUMMARY_PROVIDER = "lmstudio";
process.env.TRANSLATION_PROVIDER = "lmstudio";
process.env.LM_STUDIO_CONCURRENCY = "1";
process.env.LM_STUDIO_TIMEOUT_MS = "600000";

import { getDb, closeDb } from "../api/queries/connection";
import { news, sources } from "@db/schema";
import { resetTokenUsage, getTokenUsage } from "../api/ai/tokenUsage";
import { inArray, notInArray, desc, and } from "drizzle-orm";

const { runParseAgent } = await import("../api/agent/parseAgent");
const { runSummarizeAgent } = await import("../api/agent/summarizeAgent");
const { runTranslateAgent } = await import("../api/agent/translateAgent");
const { runDeployAgent } = await import("../api/agent/deployAgent");

const TARGET = 30;

interface StageResult {
  name: string;
  durationMs: number;
  articles: number;
  tokens: { lmStudio: number; gigaChat: number };
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function tokensSnapshot(total: ReturnType<typeof getTokenUsage>) {
  return { lmStudio: total.lmStudio.totalTokens, gigaChat: total.gigaChat.totalTokens };
}

function tokensDelta(before: ReturnType<typeof tokensSnapshot>, after: ReturnType<typeof tokensSnapshot>) {
  return {
    lmStudio: after.lmStudio - before.lmStudio,
    gigaChat: after.gigaChat - before.gigaChat,
  };
}

async function trimPendingTo(target: number): Promise<number> {
  const db = getDb();
  const pending = await db
    .select({ id: news.id })
    .from(news)
    .where(inArray(news.status, ["pending"]))
    .orderBy(desc(news.id))
    .limit(target);

  if (pending.length <= target) return pending.length;

  const keepIds = pending.map((r) => r.id);
  await db.delete(news).where(and(inArray(news.status, ["pending"]), notInArray(news.id, keepIds)));
  return target;
}

async function main() {
  const db = getDb();
  resetTokenUsage();

  console.log(`\n🧪 Full pipeline test cycle started (target: ${TARGET} articles)\n`);

  // Limit parsing to a few fast, high-yield sources so the test finishes quickly
  const allowedSources = [
    "ArXiv cs.AI",
    "ArXiv cs.CL (NLP)",
    "ArXiv cs.LG (ML)",
    "MIT News AI",
    "MIT Technology Review AI",
  ];
  const allSourceRows = await db.select({ id: sources.id, name: sources.name, enabled: sources.enabled }).from(sources);
  const allowedIds = allSourceRows.filter((s) => allowedSources.includes(s.name)).map((s) => s.id);
  const previouslyEnabledIds = allSourceRows.filter((s) => s.enabled).map((s) => s.id);
  if (allowedIds.length > 0) {
    await db.update(sources).set({ enabled: false }).where(notInArray(sources.id, allowedIds));
    console.log(`Limited parsing to ${allowedIds.length} fast sources`);
  }

  // Clean up leftover unfinished articles from previous runs to keep measurements clean
  const cleanup = await db
    .delete(news)
    .where(inArray(news.status, ["pending", "summarized", "translated"]))
    .returning({ id: news.id });
  console.log(`Cleaned ${cleanup.length} unfinished articles from previous runs`);

  const stages: StageResult[] = [];

  // Stage 1: Parse
  const parseStart = Date.now();
  const parseBefore = tokensSnapshot(getTokenUsage());
  const parseResults = await runParseAgent();
  const parseAfter = tokensSnapshot(getTokenUsage());
  const parseTotalNew = parseResults.reduce((sum, r) => sum + r.articlesNew, 0);
  const kept = await trimPendingTo(TARGET);
  stages.push({
    name: "Parse",
    durationMs: Date.now() - parseStart,
    articles: kept,
    tokens: tokensDelta(parseBefore, parseAfter),
  });
  console.log(`  Parsed ${parseTotalNew} new articles, kept ${kept} for processing`);

  if (kept === 0) {
    console.log("No articles to process — aborting test.");
    await closeDb();
    return;
  }

  // Stage 2: Summarize
  const summaryStart = Date.now();
  const summaryBefore = tokensSnapshot(getTokenUsage());
  const summaryResult = await runSummarizeAgent(TARGET);
  const summaryAfter = tokensSnapshot(getTokenUsage());
  stages.push({
    name: "Summarize",
    durationMs: Date.now() - summaryStart,
    articles: summaryResult.summarized,
    tokens: tokensDelta(summaryBefore, summaryAfter),
  });
  console.log(`  Summarized ${summaryResult.summarized} articles`);

  // Stage 3: Translate
  const translateStart = Date.now();
  const translateBefore = tokensSnapshot(getTokenUsage());
  const translateResult = await runTranslateAgent(TARGET);
  const translateAfter = tokensSnapshot(getTokenUsage());
  stages.push({
    name: "Translate",
    durationMs: Date.now() - translateStart,
    articles: translateResult.translated,
    tokens: tokensDelta(translateBefore, translateAfter),
  });
  console.log(`  Translated ${translateResult.translated} articles`);

  // Stage 4: Deploy
  const deployStart = Date.now();
  const deployBefore = tokensSnapshot(getTokenUsage());
  const deployResult = await runDeployAgent();
  const deployAfter = tokensSnapshot(getTokenUsage());
  stages.push({
    name: "Deploy",
    durationMs: Date.now() - deployStart,
    articles: deployResult.deployed,
    tokens: tokensDelta(deployBefore, deployAfter),
  });
  console.log(`  Deployed ${deployResult.deployed} articles`);

  // Totals
  const totalDuration = stages.reduce((sum, s) => sum + s.durationMs, 0);
  const totalTokens = {
    lmStudio: stages.reduce((sum, s) => sum + s.tokens.lmStudio, 0),
    gigaChat: stages.reduce((sum, s) => sum + s.tokens.gigaChat, 0),
  };

  console.log("\n📊 Results");
  console.log("=".repeat(70));
  console.log(`${"Stage".padEnd(12)} ${"Time".padStart(10)} ${"Articles".padStart(10)} ${"LM tokens".padStart(12)} ${"Giga tokens".padStart(12)}`);
  console.log("-".repeat(70));
  for (const s of stages) {
    console.log(
      `${s.name.padEnd(12)} ${formatMs(s.durationMs).padStart(10)} ${String(s.articles).padStart(10)} ${String(s.tokens.lmStudio).padStart(12)} ${String(s.tokens.gigaChat).padStart(12)}`
    );
  }
  console.log("-".repeat(70));
  console.log(
    `${"Total".padEnd(12)} ${formatMs(totalDuration).padStart(10)} ${"-".padStart(10)} ${String(totalTokens.lmStudio).padStart(12)} ${String(totalTokens.gigaChat).padStart(12)}`
  );
  console.log("=".repeat(70));
  console.log(`Total AI tokens consumed: ${totalTokens.lmStudio + totalTokens.gigaChat}\n`);

  // Restore original source enabled state
  if (previouslyEnabledIds.length > 0) {
    await db.update(sources).set({ enabled: true }).where(inArray(sources.id, previouslyEnabledIds));
    console.log("Restored original source enabled state");
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error("Test cycle failed:", error);
  try {
    const db = getDb();
    if (typeof previouslyEnabledIds !== "undefined" && previouslyEnabledIds.length > 0) {
      await db.update(sources).set({ enabled: true }).where(inArray(sources.id, previouslyEnabledIds));
      console.log("Restored original source enabled state");
    }
  } catch {
    // ignore restore errors
  }
  await closeDb();
  process.exit(1);
});
