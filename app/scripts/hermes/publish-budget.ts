/**
 * publish-budget.ts — the day's publication budget and the cycle counters that
 * prove it (R08, R08.1, R17, R18, R19; interfaces.md §9).
 *
 * Why budget and counters live together: "не больше бюджета в день" is only
 * verifiable if the cycle records what happened to every candidate — how many
 * were collected, how many the cheap prefilter dropped, how many the judge
 * dropped and why, how many were published. The same module owns both numbers.
 *
 * `pipeline_state.metrics` is the day's ledger: one row per UTC calendar day
 * (`cycle-YYYY-MM-DD`), so a retry after a failure continues the same cycle and
 * a second run after the release is committed can see it.
 */

import "dotenv/config";
import { getDb } from "../../api/queries/connection";
import { news, pipelineState } from "@db/schema";
import { and, eq, sql } from "drizzle-orm";

/** Allowed range for the hard daily publication budget (owner: «5–10 в день»). */
export const DAILY_BUDGET_MIN = 5;
export const DAILY_BUDGET_MAX = 10;
export const DAILY_BUDGET_DEFAULT = 8;

/** Cycle stages written to `pipeline_state.stage`. */
export const CYCLE_STAGE = {
  /** Stage A/B + scoring finished; counters for the day are in place. */
  evaluated: "evaluated",
  /** The day's release is published; a second run must not publish again. */
  published: "published",
} as const;

/** Bad DAILY_BUDGET is a configuration error, never a silent default. */
export class BudgetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetConfigError";
  }
}

/** One candidate for the day's budget: rank it by score, then confidence, then freshness. */
export type Candidate = {
  id: number;
  score: number | null;
  /** Judge confidence (0..1) from `metrics.judge`; `null` when there is no verdict. */
  confidence: number | null;
  publishedAt: Date | string | null;
};

/** Token spend of the cycle (interfaces.md §1: provider usage is never dropped). */
export type UsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
};

export type CycleCounters = {
  /** Candidates the cycle has seen. */
  collected: number;
  /** Candidates that passed the cheap prefilter and reached the judge. */
  prefiltered: number;
  /** Candidates the judge confirmed as on-topic. */
  judged: number;
  /** Candidates above the score gate (manifest queue). */
  approved: number;
  /** Published articles of the day (absolute value, `max` across merges). */
  published: number;
  /** Machine reason → count: `prefilter:<reason>`, `judge:<reason>`, `score:<reason>`, `publish:<reason>`, `provider:<reason>`. */
  rejectedByReason: Record<string, number>;
  /** Tokens the LLM providers reported for this cycle. */
  usage: UsageTotals;
};

export type CycleMetrics = CycleCounters;

/** `DAILY_BUDGET` from env: default 8, allowed 5..10, anything else is a config error. */
export function dailyBudget(raw: string | undefined = process.env.DAILY_BUDGET): number {
  const value = (raw ?? "").trim();
  if (!value) return DAILY_BUDGET_DEFAULT;
  if (!/^\d+$/.test(value)) {
    throw new BudgetConfigError(
      `DAILY_BUDGET must be an integer between ${DAILY_BUDGET_MIN} and ${DAILY_BUDGET_MAX}, got "${value}"`,
    );
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < DAILY_BUDGET_MIN || parsed > DAILY_BUDGET_MAX) {
    throw new BudgetConfigError(
      `DAILY_BUDGET must be between ${DAILY_BUDGET_MIN} and ${DAILY_BUDGET_MAX}, got ${parsed}`,
    );
  }
  return parsed;
}

/** A missing score ranks below any real score; a missing confidence ranks as zero. */
function scoreOf(candidate: Candidate): number {
  return typeof candidate.score === "number" && Number.isFinite(candidate.score)
    ? candidate.score
    : Number.NEGATIVE_INFINITY;
}

function confidenceOf(candidate: Candidate): number {
  return typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
    ? candidate.confidence
    : 0;
}

function publishedAtOf(candidate: Candidate): number {
  const value = candidate.publishedAt;
  if (!value) return Number.NEGATIVE_INFINITY;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Order of the day's release: score desc → confidence desc → publishedAt desc
 * (R08.1). `id` is the last tie-break so two equal rows never swap between runs
 * and a manifest is reproducible.
 */
export function compareForPublication(a: Candidate, b: Candidate): number {
  const byScore = scoreOf(b) - scoreOf(a);
  if (byScore !== 0) return byScore;
  const byConfidence = confidenceOf(b) - confidenceOf(a);
  if (byConfidence !== 0) return byConfidence;
  const byFreshness = publishedAtOf(b) - publishedAtOf(a);
  if (byFreshness !== 0) return byFreshness;
  return a.id - b.id;
}

/** Keep the best `budget` candidates; never mutates the input. */
export function selectForPublication<T extends Candidate>(
  approved: readonly T[],
  budget: number,
): T[] {
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;
  if (limit === 0) return [];
  return [...approved].sort(compareForPublication).slice(0, limit);
}

export function emptyCycleMetrics(): CycleMetrics {
  return {
    collected: 0,
    prefiltered: 0,
    judged: 0,
    approved: 0,
    published: 0,
    rejectedByReason: {},
    usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function normalizeReasons(raw: unknown): Record<string, number> {
  const reasons: Record<string, number> = {};
  for (const [reason, count] of Object.entries(asRecord(raw))) {
    const value = asCount(count);
    if (value > 0) reasons[reason] = value;
  }
  return reasons;
}

/**
 * Judge confidence for the ranking, read from `news.metrics.judge.confidence`
 * (interfaces.md §10). Anything that is not a finite 0..1 number yields `null`,
 * so a broken verdict ranks as "no confidence" instead of throwing.
 */
export function judgeConfidenceOf(metrics: unknown): number | null {
  const judge = asRecord(asRecord(metrics).judge);
  const confidence = judge.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;
  return confidence;
}

function normalizeUsage(raw: unknown): UsageTotals {
  const source = asRecord(raw);
  return {
    calls: asCount(source.calls),
    inputTokens: asCount(source.inputTokens),
    outputTokens: asCount(source.outputTokens),
  };
}

/** jsonb may hold anything: an unknown payload degrades to zeros, never to a throw. */
export function normalizeCycleMetrics(raw: unknown): CycleMetrics {
  const source = asRecord(raw);
  return {
    collected: asCount(source.collected),
    prefiltered: asCount(source.prefiltered),
    judged: asCount(source.judged),
    approved: asCount(source.approved),
    published: asCount(source.published),
    rejectedByReason: normalizeReasons(source.rejectedByReason),
    usage: normalizeUsage(source.usage),
  };
}

/**
 * Merge a stage's counters into the day's ledger. Flow counters, rejection
 * reasons and token usage add up (each run processes its own rows); `published`
 * is the absolute number of published articles today and therefore takes the
 * maximum — a retry after a crash must not double it.
 */
export function mergeCycleMetrics(base: unknown, delta: unknown): CycleMetrics {
  const left = normalizeCycleMetrics(base);
  const right = normalizeCycleMetrics(delta);
  const rejectedByReason = { ...left.rejectedByReason };
  for (const [reason, count] of Object.entries(right.rejectedByReason)) {
    rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + count;
  }
  return {
    collected: left.collected + right.collected,
    prefiltered: left.prefiltered + right.prefiltered,
    judged: left.judged + right.judged,
    approved: left.approved + right.approved,
    published: Math.max(left.published, right.published),
    rejectedByReason,
    usage: {
      calls: left.usage.calls + right.usage.calls,
      inputTokens: left.usage.inputTokens + right.usage.inputTokens,
      outputTokens: left.usage.outputTokens + right.usage.outputTokens,
    },
  };
}

/** One pipeline cycle per UTC calendar day: `cycle-YYYY-MM-DD`. */
export function cycleIdFor(now: Date = new Date()): string {
  const iso = Number.isNaN(now.getTime()) ? new Date().toISOString() : now.toISOString();
  return `cycle-${iso.slice(0, 10)}`;
}

function startOfUtcDay(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export interface CycleRecord {
  cycleId: string;
  stage: string;
  metrics: CycleMetrics;
}

export async function readCycle(cycleId: string): Promise<CycleRecord | null> {
  const db = getDb();
  const [row] = await db
    .select({ cycleId: pipelineState.cycleId, stage: pipelineState.stage, metrics: pipelineState.metrics })
    .from(pipelineState)
    .where(eq(pipelineState.cycleId, cycleId))
    .limit(1);
  if (!row) return null;
  return { cycleId: row.cycleId, stage: row.stage, metrics: normalizeCycleMetrics(row.metrics) };
}

/** Published articles of the current UTC day — the authoritative cap input. */
export async function countPublishedToday(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const dayStart = startOfUtcDay(now);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(news)
    .where(
      and(
        eq(news.status, "published"),
        sql`coalesce(${news.platformPublishedAt}, ${news.updatedAt}) >= ${dayStart.toISOString()}`,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Read-modify-write the day's row. The harness runs the pipeline steps
 * sequentially, so two writers never race inside a cycle.
 */
export async function recordCycle(
  cycleId: string,
  delta: Partial<CycleMetrics>,
  stage?: string,
): Promise<CycleMetrics> {
  const db = getDb();
  const existing = await readCycle(cycleId);
  const metrics = mergeCycleMetrics(existing?.metrics ?? emptyCycleMetrics(), delta);
  // A committed release is final for the day: a later stage must never move the
  // row back to "evaluated" and reopen publishing.
  const nextStage =
    existing?.stage === CYCLE_STAGE.published && stage !== CYCLE_STAGE.published
      ? CYCLE_STAGE.published
      : (stage ?? existing?.stage ?? CYCLE_STAGE.evaluated);

  if (existing) {
    await db
      .update(pipelineState)
      .set({
        stage: nextStage,
        metrics,
        totalArticles: metrics.collected,
        processedArticles: metrics.published,
        ...(nextStage === CYCLE_STAGE.published ? { completedAt: new Date() } : {}),
      })
      .where(eq(pipelineState.cycleId, cycleId));
  } else {
    await db.insert(pipelineState).values({
      cycleId,
      stage: nextStage,
      metrics,
      totalArticles: metrics.collected,
      processedArticles: metrics.published,
      startedAt: new Date(),
      ...(nextStage === CYCLE_STAGE.published ? { completedAt: new Date() } : {}),
    });
  }
  return metrics;
}

export interface CycleStatus {
  cycleId: string;
  stage: string;
  /** The day's release is committed: a second run must not publish again. */
  released: boolean;
  /** Published articles of the current UTC day (authoritative cap input). */
  published: number;
  budget: number;
  metrics: CycleMetrics;
}

/** Read-only state for the loop: "has today's release happened?" and the counters. */
export async function cycleStatus(now: Date = new Date()): Promise<CycleStatus> {
  const budget = dailyBudget();
  const cycleId = cycleIdFor(now);
  const cycle = await readCycle(cycleId);
  const published = await countPublishedToday(now);
  return {
    cycleId,
    stage: cycle?.stage ?? "idle",
    released: cycle?.stage === CYCLE_STAGE.published,
    published,
    budget,
    metrics: cycle?.metrics ?? emptyCycleMetrics(),
  };
}

/**
 * Small operator interface for the shell loop:
 *   --status            JSON state of the current UTC day's cycle
 *   --reject <reason>   count one refusal (e.g. provider:unavailable)
 * Kept here because the cycle ledger and the budget are the same concern.
 */
async function cli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const now = new Date();

  if (argv.includes("--status")) {
    console.log(JSON.stringify(await cycleStatus(now)));
    // The pg pool keeps the event loop alive; the loop reads one JSON line and
    // must not wait for the connection to time out.
    process.exit(0);
  }

  const rejectIndex = argv.indexOf("--reject");
  if (rejectIndex >= 0) {
    const reason = (argv[rejectIndex + 1] ?? "").trim();
    if (!reason) throw new BudgetConfigError("--reject needs a reason token");
    const countIndex = argv.indexOf("--count");
    const parsed = countIndex >= 0 ? Number.parseInt(argv[countIndex + 1] ?? "", 10) : 1;
    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const cycleId = cycleIdFor(now);
    const metrics = await recordCycle(cycleId, { rejectedByReason: { [reason]: count } });
    console.log(JSON.stringify({ status: "ok", cycleId, reason, count, metrics }));
    process.exit(0);
  }

  console.error(
    [
      "Usage:",
      "  npx tsx scripts/hermes/publish-budget.ts --status",
      "  npx tsx scripts/hermes/publish-budget.ts --reject <reason> [--count N]",
    ].join("\n"),
  );
  process.exitCode = 1;
}

const invokedDirectly = (process.argv[1] ?? "").endsWith("publish-budget.ts");
if (invokedDirectly) {
  cli().catch((err) => {
    console.error("[publish-budget] Fatal error:", err);
    process.exit(1);
  });
}
