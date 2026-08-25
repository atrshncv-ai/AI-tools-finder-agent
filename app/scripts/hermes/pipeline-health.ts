/**
 * pipeline-health.ts — Pipeline self-monitoring for the morning digest.
 *
 * Aggregates the last 24h of pipeline activity (collected / evaluated /
 * published / processing errors), feed health from `source_health`,
 * the persisted Zen key-pool state and the age of the last publication.
 * `formatHealthLine` is a pure function so the digest stays testable.
 */

import { getDb } from "../../api/queries/connection";
import { news, sources, sourceHealth, agentState } from "@db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

export interface PipelineStats {
  collected: number;
  evaluated: number;
  published: number;
  processingErrors: number;
  feedsTotal: number;
  feedsFailing: number;
  failingFeedNames: string[];
  zenPoolSize: number;
  zenCoolingKeys: number;
  zenStateUpdatedAt: string | null;
  lastPublishedAt: Date | null;
}

export async function collectPipelineStats(since: Date): Promise<PipelineStats> {
  const db = getDb();
  const sinceIso = since.toISOString();

  const [collected] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(news)
    .where(gte(news.createdAt, since));

  const [evaluated] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(news)
    .where(sql`${news.metrics}->>'evaluatedAt' >= ${sinceIso}`);

  const [published] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(news)
    .where(
      and(
        eq(news.status, "published"),
        sql`coalesce(${news.platformPublishedAt}, ${news.updatedAt}) >= ${sinceIso}`,
      ),
    );

  const [processingErrors] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(news)
    .where(
      and(
        gte(news.updatedAt, since),
        sql`exists (
          select 1 from jsonb_each_text(${news.metrics}->'processingFailures') f
          where f.value::jsonb->>'lastFailedAt' >= ${sinceIso}
        )`,
      ),
    );

  const feedRows = await db
    .select({
      name: sourceHealth.sourceName,
      consecutiveFails: sourceHealth.consecutiveFails,
    })
    .from(sourceHealth)
    .innerJoin(sources, eq(sourceHealth.sourceId, sources.id))
    .where(eq(sources.type, "hermes-feed"));
  const failing = feedRows.filter((f) => f.consecutiveFails >= 3);

  const [zenRow] = await db
    .select({ status: agentState.status, updatedAt: agentState.updatedAt })
    .from(agentState)
    .where(eq(agentState.agentId, "zen-key-pool"))
    .limit(1);
  let zenPoolSize = 0;
  let zenCoolingKeys = 0;
  let zenStateUpdatedAt: string | null = null;
  if (zenRow?.status) {
    try {
      const parsed = JSON.parse(zenRow.status) as { poolSize?: number; coolingKeys?: number; updatedAt?: string };
      zenPoolSize = parsed.poolSize ?? 0;
      zenCoolingKeys = parsed.coolingKeys ?? 0;
      zenStateUpdatedAt = parsed.updatedAt ?? null;
    } catch {
      // unparsable state — report zeros
    }
  }

  const [lastPub] = await db
    .select({ ts: sql<Date>`max(coalesce(${news.platformPublishedAt}, ${news.updatedAt}))` })
    .from(news)
    .where(eq(news.status, "published"));

  return {
    collected: collected?.n ?? 0,
    evaluated: evaluated?.n ?? 0,
    published: published?.n ?? 0,
    processingErrors: processingErrors?.n ?? 0,
    feedsTotal: feedRows.length,
    feedsFailing: failing.length,
    failingFeedNames: failing.map((f) => f.name),
    zenPoolSize,
    zenCoolingKeys,
    zenStateUpdatedAt,
    lastPublishedAt: lastPub?.ts ? new Date(lastPub.ts) : null,
  };
}

/**
 * One digest line summarising pipeline health. ⚠️ marks degradation:
 * zero publications while collection works, failing feeds, all Zen keys
 * cooling, or no publication for > 36h.
 */
export function formatHealthLine(stats: PipelineStats, now = new Date()): string {
  const warnings: string[] = [];
  if (stats.collected > 0 && stats.published === 0) warnings.push("нет публикаций за 24ч");
  if (stats.feedsFailing > 0) warnings.push(`фиды падают: ${stats.failingFeedNames.slice(0, 3).join(", ")}`);
  if (stats.zenPoolSize > 0 && stats.zenCoolingKeys >= stats.zenPoolSize) warnings.push("все Zen-ключи в cooldown");
  if (stats.lastPublishedAt && now.getTime() - stats.lastPublishedAt.getTime() > 36 * 3600_000) {
    warnings.push("последняя публикация старше 36ч");
  }

  const zenAlive = stats.zenPoolSize > 0 ? stats.zenPoolSize - stats.zenCoolingKeys : 0;
  const zenPart = stats.zenPoolSize > 0 ? ` · Zen ${zenAlive}/${stats.zenPoolSize}` : "";
  const prefix = warnings.length > 0 ? `⚠️ ⚙️ Конвейер (${warnings.join("; ")})` : "⚙️ Конвейер";
  return (
    `${prefix}: собрано ${stats.collected} · оценено ${stats.evaluated} · ` +
    `опубликовано ${stats.published} · ошибок ${stats.processingErrors}` +
    (stats.feedsTotal > 0 ? ` · фиды ${stats.feedsTotal - stats.feedsFailing}/${stats.feedsTotal}` : "") +
    zenPart
  );
}

/** Persist Zen key-pool state so other processes (digest) can report it. */
export async function persistZenPoolState(state: {
  poolSize: number;
  activeIndex: number;
  coolingKeys: number;
}): Promise<void> {
  try {
    const db = getDb();
    const payload = JSON.stringify({ ...state, updatedAt: new Date().toISOString() });
    const now = new Date();
    await db
      .insert(agentState)
      .values({ agentId: "zen-key-pool", status: payload, lastRun: now, updatedAt: now })
      .onConflictDoUpdate({
        target: agentState.agentId,
        set: { status: payload, lastRun: now, updatedAt: now },
      });
  } catch {
    // health persistence is best-effort; never surface to callers
  }
}
