/**
 * feed-health.ts — Per-source health records for the Hermes collector.
 *
 * collect-dual feeds are hardcoded (not rows in `sources`), so each feed gets
 * an upserted `sources` row (type='hermes-feed') plus a `source_health` record.
 * Best-effort by design: health persistence must never break collection.
 */

import { getDb } from "../../api/queries/connection";
import { sources, sourceHealth } from "@db/schema";
import { eq } from "drizzle-orm";

const FAILING_THRESHOLD = 3;

export async function recordFeedHealth(
  name: string,
  url: string,
  ok: boolean,
  found: number,
  error?: string,
): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();

    let sourceRow = (await db.select({ id: sources.id }).from(sources).where(eq(sources.name, name)).limit(1))[0];
    if (!sourceRow) {
      const inserted = await db
        .insert(sources)
        .values({ name, url, type: "hermes-feed", enabled: true })
        .returning({ id: sources.id });
      sourceRow = inserted[0];
    }

    const existing = (
      await db.select().from(sourceHealth).where(eq(sourceHealth.sourceId, sourceRow.id)).limit(1)
    )[0];

    const runCount = (existing?.runCount ?? 0) + 1;
    const successCount = (existing?.successCount ?? 0) + (ok ? 1 : 0);
    const consecutiveFails = ok ? 0 : (existing?.consecutiveFails ?? 0) + 1;

    const values = {
      sourceId: sourceRow.id,
      sourceName: name,
      status: consecutiveFails >= FAILING_THRESHOLD ? "failing" : ok ? "ok" : "degraded",
      lastCheck: now,
      ...(ok ? { lastSuccess: now } : {}),
      ...(error ? { lastError: error.slice(0, 300) } : {}),
      consecutiveFails,
      successRate: successCount / runCount,
      runCount,
      successCount,
      updatedAt: now,
    };

    if (existing) {
      await db.update(sourceHealth).set(values).where(eq(sourceHealth.sourceId, sourceRow.id));
    } else {
      await db.insert(sourceHealth).values(values);
    }
  } catch (err) {
    console.error(`[feed-health] Failed to record ${name}: ${(err as Error).message.slice(0, 120)}`);
  }
}
