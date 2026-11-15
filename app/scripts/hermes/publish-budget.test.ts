/**
 * publish-budget.test.ts — the daily token budget and the publish floor.
 *
 * The owner's complaint: a score of 50 cut materials the judge had already
 * approved at 40-45, so one item a day was published instead of five to ten.
 * The publication floor is now separate from the approval gate, and the judge
 * itself is bounded by a hard daily token budget.
 *
 * No DB, no network: every provider answer is an injected `completeJson`.
 */

import { describe, expect, it } from "vitest";
import {
  DAILY_TOKEN_BUDGET,
  JUDGE_MAX_CANDIDATES,
  PUBLISH_SCORE_FLOOR,
  SCORE_GATE,
} from "./pipeline-config";
import {
  dailyTokenBudget,
  emptyCycleMetrics,
  judgeMaxCandidates,
  mergeCycleMetrics,
  normalizeCycleMetrics,
  publishScoreFloor,
  selectForPublication,
  tokenBudgetExceeded,
  tokenBudgetSpent,
  type UsageTotals,
} from "./publish-budget";
import { planPublication, type ReadyArticle } from "./deploy-ready";
import {
  runEvaluationCycle,
  updateForOutcome,
  type EvaluationCandidate,
} from "./evaluate-news";

const NOW = new Date("2026-11-15T12:00:00Z");
const PUBLISHED_AT = new Date("2026-11-15T10:00:00Z");

describe("pipeline configuration: token budget and publish floor", () => {
  it("keeps the agreed defaults and the old approval gate", () => {
    expect(SCORE_GATE).toBe(50);
    expect(PUBLISH_SCORE_FLOOR).toBe(35);
    expect(DAILY_TOKEN_BUDGET).toBe(800_000);
    expect(JUDGE_MAX_CANDIDATES).toBe(200);
  });

  it("reads the daily token budget from env, with 800k as the default", () => {
    expect(dailyTokenBudget("")).toBe(DAILY_TOKEN_BUDGET);
    expect(dailyTokenBudget("120000")).toBe(120_000);
    expect(() => dailyTokenBudget("many")).toThrow(/DAILY_TOKEN_BUDGET/);
    expect(() => dailyTokenBudget("-1")).toThrow(/DAILY_TOKEN_BUDGET/);
  });

  it("reads the judge cap and the publish floor from env", () => {
    expect(judgeMaxCandidates("")).toBe(JUDGE_MAX_CANDIDATES);
    expect(judgeMaxCandidates("50")).toBe(50);
    expect(publishScoreFloor("")).toBe(PUBLISH_SCORE_FLOOR);
    expect(publishScoreFloor("40")).toBe(40);
    expect(() => judgeMaxCandidates("nope")).toThrow(/JUDGE_MAX_CANDIDATES/);
    expect(() => publishScoreFloor("nope")).toThrow(/PUBLISH_SCORE_FLOOR/);
  });

  it("sums input and output tokens and compares them with the daily limit", () => {
    const spend = { inputTokens: 13_931, outputTokens: 1_562 };
    expect(tokenBudgetSpent(spend)).toBe(15_493);
    expect(tokenBudgetSpent(null)).toBe(0);
    expect(tokenBudgetExceeded({ inputTokens: 900, outputTokens: 100 }, 1_000)).toBe(true);
    expect(tokenBudgetExceeded({ inputTokens: 899, outputTokens: 100 }, 1_000)).toBe(false);
  });
});

describe("selectForPublication: the publish floor", () => {
  const candidate = (id: number, score: number, confidence: number) => ({
    id,
    score,
    confidence,
    publishedAt: PUBLISHED_AT,
  });

  it("keeps judge-approved thematic materials at 35..49 and drops a score of 20", () => {
    const approved = [candidate(1, 40, 0.9), candidate(2, 20, 0.95), candidate(3, 35, 0.8)];
    expect(
      selectForPublication(approved, 8, { floor: PUBLISH_SCORE_FLOOR }).map((item) => item.id),
    ).toEqual([1, 3]);
  });

  it("never publishes an unscored material even when a floor is set", () => {
    const approved = [candidate(1, Number.NaN, 0.9), candidate(2, 40, 0.8)];
    expect(selectForPublication(approved, 8, { floor: 35 }).map((item) => item.id)).toEqual([2]);
  });
});

function ready(id: number, score: number, confidence = 0.9): ReadyArticle {
  return { id, title: `#${id}`, score, confidence, publishedAt: PUBLISHED_AT };
}

describe("publication: the floor decides what actually goes out", () => {
  it("publishes a judge-approved material with score 40", () => {
    const plan = planPublication({
      ready: [ready(1, 40)],
      budget: 8,
      publishedToday: 0,
      releaseCommitted: false,
      scoreFloor: PUBLISH_SCORE_FLOOR,
    });
    expect(plan.allowed).toBe(true);
    expect(plan.items.map((item) => item.id)).toEqual([1]);
  });

  it("does not publish a material with score 20", () => {
    const plan = planPublication({
      ready: [ready(2, 20)],
      budget: 8,
      publishedToday: 0,
      releaseCommitted: false,
      scoreFloor: PUBLISH_SCORE_FLOOR,
    });
    expect(plan.allowed).toBe(false);
    expect(plan.items).toEqual([]);
    expect(plan.reason).toBe("below-publish-floor");
  });
});

function newsCandidate(index: number, overrides: Partial<EvaluationCandidate> = {}): EvaluationCandidate {
  return {
    id: index,
    title: `AI model ${index} sets a new reasoning benchmark`,
    lead: `An AI lab reports that model ${index} improves step-by-step reasoning on public tests.`,
    originalUrl: `https://example.org/news/${index}`,
    source: "example-news",
    publishedAt: PUBLISHED_AT,
    isScience: false,
    language: "en",
    section: "ai-news",
    sphereTags: [],
    metrics: { origin: "rss", hasDescription: true },
    ...overrides,
  };
}

/** The judge contract: a verdict and an independent review, both as JSON. */
function answer(args: { messages: { role: string; content: string }[] }) {
  const user = args.messages[1]?.content ?? "";
  const review = user.includes("Первый судья вынес вердикт");
  return {
    text: JSON.stringify(
      review
        ? { agree: true, confidence: 0.95, reason: "подтверждаю" }
        : {
            onTopic: true,
            section: "ai-news",
            direction: null,
            confidence: 0.9,
            reason: "AI-модель и её бенчмарк",
          },
    ),
    provider: "gigachat" as const,
    model: "GigaChat",
    usage: { inputTokens: 100, outputTokens: 20 },
  };
}

const scoreAt = (score: number) =>
  async (item: EvaluationCandidate) => ({
    id: item.id,
    title: item.title,
    score,
    breakdown: [],
    metrics: {},
  });

describe("evaluate-news: approval below the old score gate", () => {
  it("approves a judge-approved material with score 40 and leaves it publishable", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1)],
      budget: 8,
      deps: { now: NOW, completeJson: answer as never, score: scoreAt(40) },
    });
    const outcome = result.outcomes[0];
    expect(outcome.decision).toBe("approved");
    expect(result.counters.approved).toBe(1);
    const update = updateForOutcome(outcome);
    expect(update.score).toBe(40);
    expect(update).not.toHaveProperty("status");
  });

  it("rejects a judge-approved material with score 20", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(2)],
      budget: 8,
      deps: { now: NOW, completeJson: answer as never, score: scoreAt(20) },
    });
    expect(result.outcomes[0].decision).toBe("rejected-low-score");
    expect(result.counters.approved).toBe(0);
    expect(result.counters.rejectedByReason["score:low-score"]).toBe(1);
    expect(updateForOutcome(result.outcomes[0]).status).toBe("rejected");
  });
});

describe("evaluate-news: hard daily token budget", () => {
  it("stops new judge calls when the budget is spent and counts the token-budget reason", async () => {
    let calls = 0;
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1), newsCandidate(2), newsCandidate(3)],
      budget: 8,
      deps: {
        now: NOW,
        // 100 tokens for one candidate's verdict + review; 120 is already spent
        // after the first candidate, so the next two never reach the judge.
        tokenBudget: 100,
        spentTokens: 0,
        completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
          calls++;
          return answer(args);
        }) as never,
        score: scoreAt(40),
      },
    });

    expect(calls).toBe(2);
    expect(result.judgeCalls).toBe(1);
    expect(result.tokenBudgetExceeded).toBe(true);
    expect(result.counters.rejectedByReason["judge:token-budget"]).toBe(2);
    expect(
      result.outcomes.filter((outcome) => outcome.decision === "deferred-budget").map((outcome) => ({
        id: outcome.candidate.id,
        reason: outcome.metrics.deferReason,
      })),
    ).toEqual([
      { id: 2, reason: "token-budget" },
      { id: 3, reason: "token-budget" },
    ]);
  });

  it("does not call the judge at all when the day's budget is already exhausted", async () => {
    let calls = 0;
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1), newsCandidate(2)],
      budget: 8,
      deps: {
        now: NOW,
        tokenBudget: 50_000,
        spentTokens: 50_000,
        completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
          calls++;
          return answer(args);
        }) as never,
        score: scoreAt(40),
      },
    });
    expect(calls).toBe(0);
    expect(result.judgeCalls).toBe(0);
    expect(result.counters.rejectedByReason["judge:token-budget"]).toBe(2);
  });

  it("judges only the top-N candidates by prefilter score", async () => {
    const judged: string[] = [];
    const result = await runEvaluationCycle({
      candidates: Array.from({ length: 5 }, (_, index) => newsCandidate(index + 1)),
      budget: 8,
      deps: {
        now: NOW,
        judgeMaxCandidates: 2,
        completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
          const user = args.messages[1]?.content ?? "";
          if (!user.includes("Первый судья вынес вердикт")) judged.push(user);
          return answer(args);
        }) as never,
        score: scoreAt(40),
      },
    });

    expect(judged).toHaveLength(2);
    expect(result.judgeCalls).toBe(2);
    expect(result.counters.rejectedByReason["judge:candidate-cap"]).toBe(3);
  });
});

describe("cycle metrics: per-stage usage", () => {
  it("records judge and review calls separately, keeping the legacy totals", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1)],
      budget: 8,
      deps: { now: NOW, completeJson: answer as never, score: scoreAt(40) },
    });

    expect(result.usage).toEqual({
      calls: 2,
      inputTokens: 200,
      outputTokens: 40,
      judge: { calls: 1, inputTokens: 100, outputTokens: 20 },
      review: { calls: 1, inputTokens: 100, outputTokens: 20 },
      summary: { calls: 0, inputTokens: 0, outputTokens: 0 },
    });
    expect(result.counters.usage).toEqual(result.usage);

    const normalized = normalizeCycleMetrics({ usage: result.usage });
    expect(normalized.usage.calls).toBe(2);
    expect(normalized.usage.judge).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20 });
    expect(normalized.usage.review).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20 });
  });

  it("counts the summary stage as the remainder of the day's plain totals", () => {
    const judged = mergeCycleMetrics(emptyCycleMetrics(), {
      usage: {
        calls: 2,
        inputTokens: 200,
        outputTokens: 40,
        judge: { calls: 1, inputTokens: 100, outputTokens: 20 },
        review: { calls: 1, inputTokens: 100, outputTokens: 20 },
      },
    });
    // save-summary writes plain totals only: the stage split must still add up.
    const merged = mergeCycleMetrics(judged, {
      usage: { calls: 1, inputTokens: 850, outputTokens: 85 },
    });
    expect(merged.usage.calls).toBe(3);
    expect(merged.usage.inputTokens).toBe(1_050);
    expect(merged.usage.summary).toEqual({ calls: 1, inputTokens: 850, outputTokens: 85 });
  });

  it("does not invent a stage split for a legacy usage payload", () => {
    const legacy = normalizeCycleMetrics({
      usage: { calls: 3, inputTokens: 300, outputTokens: 30 },
    });
    expect(legacy.usage).toEqual({ calls: 3, inputTokens: 300, outputTokens: 30 });
    expect(legacy.usage.judge).toBeUndefined();
    expect(legacy.usage.summary).toBeUndefined();
  });
});
