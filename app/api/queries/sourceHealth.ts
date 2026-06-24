import { getDb } from "./connection";
import { sourceHealth } from "@db/schema";
import type { SourceHealth } from "../agent/types";

export async function loadAllSourceHealth(): Promise<SourceHealth[]> {
  const db = getDb();
  const rows = await db.query.sourceHealth.findMany();
  return rows.map((row) => ({
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    status: row.status as SourceHealth["status"],
    lastCheck: row.lastCheck,
    lastSuccess: row.lastSuccess,
    lastError: row.lastError,
    consecutiveFails: row.consecutiveFails,
    successRate: row.successRate,
    avgResponseTime: row.avgResponseTime,
    selectorWorks: row.selectorWorks,
    runCount: row.runCount,
    successCount: row.successCount,
  }));
}

export async function saveSourceHealth(health: SourceHealth): Promise<void> {
  const db = getDb();
  await db
    .insert(sourceHealth)
    .values({
      sourceId: health.sourceId,
      sourceName: health.sourceName,
      status: health.status,
      lastCheck: health.lastCheck,
      lastSuccess: health.lastSuccess,
      lastError: health.lastError,
      consecutiveFails: health.consecutiveFails,
      successRate: health.successRate,
      avgResponseTime: health.avgResponseTime,
      selectorWorks: health.selectorWorks,
      runCount: health.runCount,
      successCount: health.successCount,
    })
    .onConflictDoUpdate({
      target: sourceHealth.sourceId,
      set: {
        sourceName: health.sourceName,
        status: health.status,
        lastCheck: health.lastCheck,
        lastSuccess: health.lastSuccess,
        lastError: health.lastError,
        consecutiveFails: health.consecutiveFails,
        successRate: health.successRate,
        avgResponseTime: health.avgResponseTime,
        selectorWorks: health.selectorWorks,
        runCount: health.runCount,
        successCount: health.successCount,
        updatedAt: new Date(),
      },
    });
}
