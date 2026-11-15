#!/usr/bin/env tsx
/**
 * deploy-ready.ts — Publishes summarized articles by setting status to 'published'.
 *
 * Usage:
 *   npx tsx scripts/hermes/deploy-ready.ts [--batch-size <n>]
 *
 * A card publishes as soon as it is summarized — a card ready at 17:00 is
 * published at 17:00, not once a day. The only cap is the day's budget: the
 * publication stage is the LAST place `DAILY_BUDGET` is enforced
 * (interfaces.md §1), because a manifest can be edited by hand and save-summary
 * can be called directly, so a publication that would exceed the budget is
 * refused with a reason instead of passing silently. The same is true of the
 * score: nothing below PUBLISH_SCORE_FLOOR is published, while a judge-approved
 * thematic material at 35..49 is not cut by the old 50-point gate.
 *
 * Output (one JSON line on stdout) is the loop's contract:
 *   { status, cycleId, budget, ready, publishedToday, planned, published,
 *     remainingBudget, reason, done }
 * `done` means "the day's budget is spent, nothing more can go out today"; the
 * loop still keeps cycling, and only the Telegram digest stays daily.
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
  publishScoreFloor,
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
  | "budget-exhausted"
  | "no-ready-articles"
  | "below-publish-floor";

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
 * The daily budget is the only cap: `remaining = budget − publishedToday`, and
 * the best of the ready queue fills those remaining slots. There is no
 * "already released today" input any more — publication is immediate.
 */
export function planPublication(input: {
  ready: readonly ReadyArticle[];
  budget: number;
  publishedToday: number;
  batchSize?: number;
  /** Publication floor; the live release passes `PUBLISH_SCORE_FLOOR` (env). */
  scoreFloor?: number;
}): PublicationPlan {
  const budget = Number.isFinite(input.budget) ? Math.max(0, Math.floor(input.budget)) : 0;
  const publishedToday = Number.isFinite(input.publishedToday)
    ? Math.max(0, Math.floor(input.publishedToday))
    : 0;
  const remainingBudget = Math.max(0, budget - publishedToday);

  if (remainingBudget === 0) {
    return { allowed: false, reason: "budget-exhausted", items: [], remainingBudget };
  }
  if (input.ready.length === 0) {
    return { allowed: false, reason: "no-ready-articles", items: [], remainingBudget };
  }

  const batchSize =
    typeof input.batchSize === "number" && Number.isFinite(input.batchSize) && input.batchSize > 0
      ? Math.floor(input.batchSize)
      : Number.POSITIVE_INFINITY;
  const limit = Math.min(remainingBudget, batchSize);
  const floor =
    typeof input.scoreFloor === "number" && Number.isFinite(input.scoreFloor)
      ? input.scoreFloor
      : 0;
  const items = selectForPublication(input.ready, limit, { floor });
  if (items.length === 0) {
    // Everything ready is below the floor: not a publication, and the owner
    // report must see why the day's queue produced nothing.
    return { allowed: false, reason: "below-publish-floor", items: [], remainingBudget };
  }
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

  const ready = await loadReady(batchSize, budget);
  const publishedToday = await countPublishedToday(now);

  const plan = planPublication({
    ready,
    budget,
    publishedToday,
    batchSize,
    // The live release always applies the floor; the pure helper keeps a
    // floorless default for callers that rank their own already-filtered rows.
    scoreFloor: publishScoreFloor(),
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
        remainingBudget: plan.remainingBudget,
        reason: plan.reason,
        done: plan.reason === "budget-exhausted",
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
      remainingBudget: Math.max(0, budget - publishedTotal),
      reason: null,
      done: publishedTotal >= budget,
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
