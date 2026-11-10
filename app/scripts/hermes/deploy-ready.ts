#!/usr/bin/env tsx
/**
 * deploy-ready.ts — Publishes summarized articles by setting status to 'published'.
 *
 * Usage:
 *   npx tsx scripts/hermes/deploy-ready.ts [--batch-size <n>]
 *
 * The publication stage is the LAST place the day's budget is enforced
 * (interfaces.md §1): a manifest can be edited by hand and save-summary can be
 * called directly, so a publication that would exceed DAILY_BUDGET is refused
 * with a reason instead of passing silently. One release per UTC day: after the
 * day's release is committed to `pipeline_state` (stage `published`), a second
 * run publishes nothing.
 *
 * Output (one JSON line on stdout) is the loop's contract:
 *   { status, cycleId, budget, ready, publishedToday, planned, published,
 *     reason, released, done }
 * `done` means "nothing more will be published today", so the loop can wait for
 * the next day instead of retrying.
 *
 * Exit codes: 0 = success or a documented refusal, 1 = error (including a bad
 * DAILY_BUDGET: a configuration error at start-up, not a silent default).
 */

import "dotenv/config";
import { getDb } from "../../api/queries/connection";
import { news, inventionTools } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import {
  CYCLE_STAGE,
  cycleIdFor,
  countPublishedToday,
  dailyBudget,
  judgeConfidenceOf,
  readCycle,
  recordCycle,
  selectForPublication,
  type Candidate,
} from "./publish-budget";

export function parseArgs(argv: string[] = process.argv.slice(2)): { batchSize: number } {
  let batchSize = 50;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--batch-size" || argv[i] === "-b") {
      const parsed = Number.parseInt(argv[++i] || "", 10);
      if (Number.isFinite(parsed) && parsed > 0) batchSize = parsed;
    }
  }
  return { batchSize };
}

export interface ReadyArticle extends Candidate {
  title: string;
}

/** Why the publication stage did not publish. */
export type PublicationRefusal =
  | "already-published-today"
  | "daily-budget-exhausted"
  | "no-ready-articles";

export interface PublicationPlan {
  allowed: boolean;
  reason: PublicationRefusal | null;
  items: ReadyArticle[];
  /** Budget left for today before this run, never negative. */
  remainingBudget: number;
}

/**
 * Pure decision for one publication call; the DB is read by `main()`.
 *
 * Order of the checks matters: a committed release wins over the budget (the
 * budget number alone cannot tell "already released" from "not yet reached"),
 * and an empty queue is reported instead of exiting silently.
 */
export function planPublication(input: {
  ready: readonly ReadyArticle[];
  budget: number;
  publishedToday: number;
  releaseCommitted: boolean;
  batchSize?: number;
}): PublicationPlan {
  const budget = Number.isFinite(input.budget) ? Math.max(0, Math.floor(input.budget)) : 0;
  const publishedToday = Number.isFinite(input.publishedToday)
    ? Math.max(0, Math.floor(input.publishedToday))
    : 0;
  const remainingBudget = Math.max(0, budget - publishedToday);

  if (input.releaseCommitted) {
    return { allowed: false, reason: "already-published-today", items: [], remainingBudget };
  }
  if (remainingBudget === 0) {
    return { allowed: false, reason: "daily-budget-exhausted", items: [], remainingBudget };
  }
  if (input.ready.length === 0) {
    return { allowed: false, reason: "no-ready-articles", items: [], remainingBudget };
  }

  const batchSize =
    typeof input.batchSize === "number" && Number.isFinite(input.batchSize) && input.batchSize > 0
      ? Math.floor(input.batchSize)
      : Number.POSITIVE_INFINITY;
  const limit = Math.min(remainingBudget, batchSize);
  const items = selectForPublication(input.ready, limit);
  return { allowed: true, reason: null, items, remainingBudget };
}

async function loadReady(batchSize: number, budget: number): Promise<ReadyArticle[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: news.id,
      title: news.title,
      score: news.score,
      metrics: news.metrics,
      publishedAt: news.publishedAt,
    })
    .from(news)
    .where(eq(news.status, "summarized"))
    // NULLS LAST: a summarized row without a score must not jump the queue.
    .orderBy(sql`${news.score} desc nulls last`, sql`${news.publishedAt} desc`)
    .limit(Math.max(batchSize, budget));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    score: row.score,
    confidence: judgeConfidenceOf(row.metrics),
    publishedAt: row.publishedAt,
  }));
}

async function main(): Promise<void> {
  const { batchSize } = parseArgs();
  const budget = dailyBudget();
  const now = new Date();
  const cycleId = cycleIdFor(now);

  const cycle = await readCycle(cycleId);
  const ready = await loadReady(batchSize, budget);
  const publishedToday = await countPublishedToday(now);

  const plan = planPublication({
    ready,
    budget,
    publishedToday,
    releaseCommitted: cycle?.stage === CYCLE_STAGE.published,
    batchSize,
  });

  if (!plan.allowed) {
    console.log(
      JSON.stringify({
        status: "skipped",
        cycleId,
        budget,
        ready: ready.length,
        publishedToday,
        planned: 0,
        published: 0,
        reason: plan.reason,
        released: plan.reason === "already-published-today",
        done: plan.reason !== "no-ready-articles",
      }),
    );
    console.error(
      `[deploy-ready] ${plan.reason}: ready=${ready.length} publishedToday=${publishedToday} budget=${budget}`,
    );
    await recordCycle(cycleId, {
      // Absolute, not additive: the ledger must agree with the news table.
      published: publishedToday,
      rejectedByReason: { [`publish:${plan.reason}`]: 1 },
    });
    return;
  }

  const db = getDb();
  let deployed = 0;
  let failed = 0;
  for (const article of plan.items) {
    try {
      await db
        .update(news)
        .set({ status: "published", updatedAt: new Date(), platformPublishedAt: new Date() })
        .where(eq(news.id, article.id));
      deployed++;
    } catch (err) {
      failed++;
      console.error(`[deploy-ready] Failed to deploy article #${article.id}:`, err);
    }
  }

  const publishedTotal = await countPublishedToday(now);
  const complete = failed === 0 && deployed === plan.items.length && deployed > 0;
  const reasons: Record<string, number> = {};
  if (failed > 0) reasons["publish:failed"] = failed;

  await recordCycle(
    cycleId,
    { published: publishedTotal, rejectedByReason: reasons },
    complete ? CYCLE_STAGE.published : undefined,
  );

  console.log(
    JSON.stringify({
      status: "ok",
      cycleId,
      budget,
      ready: ready.length,
      publishedToday: publishedTotal,
      planned: plan.items.length,
      published: deployed,
      reason: null,
      released: complete,
      done: complete,
    }),
  );
  console.error(
    `[deploy-ready] Published ${deployed}/${plan.items.length} (today: ${publishedTotal}/${budget})`,
  );

  if (deployed > 0) {
    // Refresh the verification stamp WITHOUT touching updatedAt: updatedAt is
    // the sort key of the merged inventions list, and bumping it on every deploy
    // pushed all 42 catalog cards above fresh news. lastVerifiedAt alone says
    // "checked recently"; updatedAt stays = when the card was added.
    try {
      await db
        .update(inventionTools)
        .set({ lastVerifiedAt: new Date() })
        .where(sql`1=1`);
      console.error("[deploy-ready] Refreshed lastVerifiedAt for all catalog tools");
    } catch (err) {
      console.error("[deploy-ready] Failed to refresh catalog verification date:", err);
    }
  }
}

// Only auto-run when executed directly (npx tsx .../deploy-ready.ts).
// Importing this module (e.g. from vitest) must not touch the DB.
const invokedDirectly = (process.argv[1] ?? "").endsWith("deploy-ready.ts");
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[deploy-ready] Fatal error:", err);
    process.exit(1);
  });
}
