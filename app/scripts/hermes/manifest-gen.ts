#!/usr/bin/env tsx
/**
 * manifest-gen.ts — Generates a manifest.json of unprocessed articles for Hermes Agent.
 *
 * Usage:
 *   npx tsx scripts/hermes/manifest-gen.ts [--output <path>] [--limit <n>] [--science-only]
 *
 * Reads articles from PostgreSQL with status='pending' and content=NULL,
 * writes a structured manifest.json for Hermes to consume.
 *
 * Exit codes: 0 = success, 1 = error
 */

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

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
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
    bySource: Record<string, number>;
  };
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

  console.log(`[manifest-gen] Generating manifest (limit=${limit}, scienceOnly=${scienceOnly})...`);

  const db = getDb();

  const whereConditions = [eq(news.status, "pending"), isNull(news.content)];
  if (scienceOnly) {
    whereConditions.push(eq(news.isScience, true));
  }

  const articles = await db
    .select()
    .from(news)
    .where(and(...whereConditions))
    .orderBy(desc(news.publishedAt))
    .limit(limit);

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
      byStatus,
      byLanguage,
      bySource,
    },
  };

  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`[manifest-gen] Written ${articles.length} articles to ${outputPath}`);
  console.log(`[manifest-gen] Cycle ID: ${cycleId}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[manifest-gen] Fatal error:", err);
  process.exit(1);
});
