/**
 * backfill-platform-published-at.ts — one-time migration.
 *
 * Sets news."platformPublishedAt" = "updatedAt" for every published article
 * that doesn't have the new immutable field yet. One-time: the field is then
 * only ever written by deploy-ready at publish time.
 */
import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const res = await db
    .update(news)
    .set({ platformPublishedAt: sql`${news.updatedAt}` })
    .where(and(eq(news.status, "published"), isNull(news.platformPublishedAt)))
    .returning({ id: news.id });

  console.log(`[backfill] platformPublishedAt set for ${res.length} published articles`);
}

main().catch((err) => {
  console.error("[backfill] FAILED:", err);
  process.exit(1);
});
