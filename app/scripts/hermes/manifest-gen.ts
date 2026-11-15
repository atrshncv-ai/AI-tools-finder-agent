#!/usr/bin/env tsx
/**
 * manifest-gen.ts — Generates a manifest.json of unprocessed articles for Hermes Agent.
 *
 * Usage:
 *   npx tsx scripts/hermes/manifest-gen.ts [--output <path>] [--limit <n>] [--science-only]
 *
 * Reads articles from PostgreSQL with status='pending', content=NULL and an
 * eligible score: >= SCORE_GATE on its own, or >= PUBLISH_SCORE_FLOOR with a
 * judge verdict that confirmed the topic (the shared publish floor, see
 * pipeline-config.ts), writes a structured manifest.json for Hermes to consume.
 * Unevaluated rows (score=NULL) NEVER reach the LLM.
 *
 * DAY BUDGET (interfaces.md §2, spec §4): the manifest carries only the best
 * DAILY_BUDGET articles by score (ties: judge confidence, then freshness). The
 * pipeline pays for summaries here, so paying for more than can be published
 * today is the very "работа впустую" the budget exists to stop.
 *
 * Exit codes: 0 = success, 1 = error (including a bad DAILY_BUDGET: a
 * configuration error at start-up, not a silent default).
 */

import "dotenv/config";
import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { SCORE_GATE } from "./pipeline-config";
import {
  dailyBudget,
  judgeConfidenceOf,
  publishScoreFloor,
  selectForPublication,
} from "./publish-budget";

// Strong scores (>= SCORE_GATE) need no extra proof; judge-approved thematic
// materials from the publication floor up must reach the summary queue too,
// otherwise they could never be published. A score below the floor is not
// "not yet", it is "never": the same floor guards the release in deploy-ready.

interface ManifestArticle {
  id: number;
  title: string;
  originalUrl: string;
  source: string;
  language: string | null;
  status: string;
  publishedAt: Date;
  categorySlug: string | null;
  isScience: boolean;
  scienceField: string | null;
  originalContent: string | null;
  content: string | null;
  summary: string | null;
}

interface Manifest {
  generatedAt: string;
  pipelineCycleId: string;
  articles: ManifestArticle[];
  summary: {
    total: number;
    pending: number;
    budget: number;
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
    bySource: Record<string, number>;
  };
}

/** The subset of a DB row the budget needs, plus the manifest fields to keep. */
type BudgetableArticle = {
  id: number;
  score: number | null;
  metrics?: unknown;
  publishedAt: Date | string;
};

/**
 * Keep the best `budget` approved articles: score desc → judge confidence desc
 * → publishedAt desc (R08.1). Pure, so the ranking is testable without a DB.
 * A positive `floor` also drops judge-approved materials below the publish
 * floor; callers that only rank (tests, legacy paths) may omit it.
 */
export function applyDailyBudget<T extends BudgetableArticle>(
  articles: readonly T[],
  budget: number,
  floor = 0,
): T[] {
  return selectForPublication(
    articles.map((article) => ({
      ...article,
      confidence: judgeConfidenceOf(article.metrics),
    })),
    budget,
    { floor },
  );
}

function parseArgs(): { outputPath: string; limit: number; scienceOnly: boolean } {
  const args = process.argv.slice(2);
  let outputPath = "manifest.json";
  let limit = 100;
  let scienceOnly = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--output":
      case "-o":
        outputPath = args[++i] || outputPath;
        break;
      case "--limit":
      case "-l":
        limit = parseInt(args[++i] || "100", 10);
        break;
      case "--science-only":
        scienceOnly = true;
        break;
    }
  }

  return { outputPath, limit, scienceOnly };
}

async function main() {
  const { outputPath, limit, scienceOnly } = parseArgs();
  const budget = dailyBudget();
  const floor = publishScoreFloor();

  console.log(
    `[manifest-gen] Generating manifest (limit=${limit}, budget=${budget}, floor=${floor}, scienceOnly=${scienceOnly})...`,
  );

  const db = getDb();

  const whereConditions = [
    eq(news.status, "pending"),
    isNull(news.content),
    // NULL scores never match (SQL NULL comparison): unevaluated rows cannot
    // slip into LLM processing. A 35..49 row is eligible only with a judge
    // verdict that confirmed the topic; >= 50 still stands on its own.
    sql`(${news.score} >= ${SCORE_GATE} OR (${news.score} >= ${floor} AND ${news.metrics}->'judge'->>'onTopic' = 'true'))`,
  ];
  if (scienceOnly) {
    whereConditions.push(eq(news.isScience, true));
  }

  // Filter in SQL, rank by the one shared ordering in JS: the query only needs
  // to be wide enough to contain the day's best.
  const rows = await db
    .select()
    .from(news)
    .where(and(...whereConditions))
    .orderBy(desc(news.score), desc(news.publishedAt))
    .limit(Math.max(limit, budget));

  const articles = applyDailyBudget(rows, budget, floor);

  const cycleId = `cycle-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-manifest`;

  const byStatus: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};
  const bySource: Record<string, number> = {};

  for (const a of articles) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    if (a.language) byLanguage[a.language] = (byLanguage[a.language] || 0) + 1;
    bySource[a.source] = (bySource[a.source] || 0) + 1;
  }

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    pipelineCycleId: cycleId,
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      originalUrl: a.originalUrl,
      source: a.source,
      language: a.language,
      status: a.status,
      publishedAt: a.publishedAt,
      categorySlug: a.categorySlug,
      isScience: a.isScience,
      scienceField: a.scienceField,
      originalContent: a.originalContent,
      content: a.content,
      summary: a.summary,
    })),
    summary: {
      total: articles.length,
      pending: articles.length,
      budget,
      byStatus,
      byLanguage,
      bySource,
    },
  };

  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`[manifest-gen] Written ${articles.length} articles to ${outputPath} (budget ${budget})`);
  console.log(`[manifest-gen] Cycle ID: ${cycleId}`);

  process.exit(0);
}

// Only auto-run when executed directly (npx tsx .../manifest-gen.ts).
// Importing this module (e.g. from vitest) must not touch the DB.
const invokedDirectly = (process.argv[1] ?? "").endsWith("manifest-gen.ts");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[manifest-gen] Fatal error:", err);
    process.exit(1);
  });
}
