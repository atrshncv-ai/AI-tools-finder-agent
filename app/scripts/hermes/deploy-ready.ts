#!/usr/bin/env tsx
/**
 * deploy-ready.ts — Publishes summarized articles by setting status to 'published'.
 *
 * Usage:
 *   npx tsx scripts/hermes/deploy-ready.ts [--batch-size <n>]
 *
 * Finds articles with status='summarized' and sets them to 'published'.
 * Exits with code 0 on success, 1 on error.
 */

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";

function parseArgs(): { batchSize: number } {
  const args = process.argv.slice(2);
  let batchSize = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch-size" || args[i] === "-b") {
      batchSize = parseInt(args[++i] || "50", 10);
    }
  }

  return { batchSize };
}

async function main() {
  const { batchSize } = parseArgs();

  console.log(`[deploy-ready] Deploying up to ${batchSize} summarized articles...`);

  const db = getDb();

  const ready = await db
    .select({ id: news.id, title: news.title })
    .from(news)
    .where(eq(news.status, "summarized"))
    .limit(batchSize);

  if (ready.length === 0) {
    console.log("[deploy-ready] No articles ready for deployment");
    process.exit(0);
  }

  let deployed = 0;
  for (const article of ready) {
    try {
      await db
        .update(news)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(news.id, article.id));
      deployed++;
    } catch (err) {
      console.error(`[deploy-ready] Failed to deploy article #${article.id}:`, err);
    }
  }

  console.log(`[deploy-ready] Deployed ${deployed}/${ready.length} articles`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[deploy-ready] Fatal error:", err);
  process.exit(1);
});
