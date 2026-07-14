#!/usr/bin/env tsx
/**
 * purge-stale.ts — Purge stale news from the dashboard.
 *
 * Deletes all articles in active/published pipeline states so the dashboard
 * starts clean (72h Time Guard + velocity scoring will refill it with fresh
 * content only). Articles with status='rejected' are KEPT by default — they
 * act as dedup memory (URL guard blocks re-collection of known junk).
 *
 * Usage:
 *   npx tsx scripts/hermes/purge-stale.ts [--dry-run] [--include-rejected]
 *
 * Exit codes: 0 = success, 1 = error
 */

import "dotenv/config";
import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { inArray, count } from "drizzle-orm";

const PURGE_STATUSES = ["pending", "summarized", "translated", "published"];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const includeRejected = process.argv.includes("--include-rejected");
  const statuses = includeRejected ? [...PURGE_STATUSES, "rejected"] : PURGE_STATUSES;

  const db = getDb();

  const [{ value: before }] = await db.select({ value: count() }).from(news);
  const victims = await db
    .select({ id: news.id, status: news.status, title: news.title, publishedAt: news.publishedAt })
    .from(news)
    .where(inArray(news.status, statuses));

  console.error(`[purge-stale] Total articles: ${before}`);
  console.error(`[purge-stale] Marked for deletion: ${victims.length} (statuses: ${statuses.join(", ")})`);
  for (const v of victims.slice(0, 20)) {
    console.error(
      `  #${v.id} [${v.status}] ${v.publishedAt?.toISOString?.().slice(0, 10) ?? "no-date"} ${v.title.slice(0, 70)}`,
    );
  }
  if (victims.length > 20) console.error(`  ... and ${victims.length - 20} more`);

  if (dryRun) {
    console.log(JSON.stringify({ status: "dry-run", total: before, wouldDelete: victims.length }));
    process.exit(0);
  }

  if (victims.length > 0) {
    await db.delete(news).where(inArray(news.status, statuses));
  }

  const [{ value: after }] = await db.select({ value: count() }).from(news);
  console.log(JSON.stringify({ status: "ok", totalBefore: before, deleted: victims.length, totalAfter: after }));
  console.error(`[purge-stale] Done: deleted ${victims.length}, ${after} article(s) remain (rejected = dedup memory)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[purge-stale] Fatal error:", err);
  process.exit(1);
});
