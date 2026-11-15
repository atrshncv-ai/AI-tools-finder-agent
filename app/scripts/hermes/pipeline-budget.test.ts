import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BudgetConfigError,
  DAILY_BUDGET_DEFAULT,
  DAILY_BUDGET_MAX,
  DAILY_BUDGET_MIN,
  cycleIdFor,
  dailyBudget,
  emptyCycleMetrics,
  judgeConfidenceOf,
  mergeCycleMetrics,
  normalizeCycleMetrics,
  remainingScoreBudget,
  scoreDailyCap,
  selectForPublication,
  type Candidate,
} from "./publish-budget";
import {
  SCORE_DAILY_CAP,
  SCORE_DAILY_CAP_MAX,
  SCORE_DAILY_CAP_MIN,
} from "./pipeline-config";
import { planPublication, type ReadyArticle } from "./deploy-ready";
import { runEvaluationCycle, updateForOutcome, type EvaluationCandidate } from "./evaluate-news";
import { ProviderError } from "../../api/ai/providers/types";
import { buildNewsRow } from "./collect-dual";
import { applyDailyBudget } from "./manifest-gen";

/**
 * Day budget: the single allowed source is DAILY_BUDGET, 1..50, default 50
 * (owner decision 2026-11-15: потолок 50, минимума нет — 20–30 хороший день,
 * 5 тоже нормально). A value outside the range is a configuration error at
 * start-up, not a silently clamped number.
 */
describe("dailyBudget (DAILY_BUDGET)", () => {
  it("defaults to 50 when the variable is unset or empty", () => {
    expect(DAILY_BUDGET_DEFAULT).toBe(50);
    expect(dailyBudget(undefined)).toBe(50);
    expect(dailyBudget("")).toBe(50);
    expect(dailyBudget("   ")).toBe(50);
  });

  it("accepts every value of the 1..50 range, including its edges", () => {
    for (let value = DAILY_BUDGET_MIN; value <= DAILY_BUDGET_MAX; value++) {
      expect(dailyBudget(String(value))).toBe(value);
    }
    expect(dailyBudget("1")).toBe(1);
    expect(dailyBudget("50")).toBe(50);
    expect(dailyBudget(" 49 ")).toBe(49);
  });

  it("rejects values below 1 and above 50 as a configuration error", () => {
    for (const raw of ["0", "-1", "-8", "51", "100"]) {
      expect(() => dailyBudget(raw)).toThrow(BudgetConfigError);
    }
    // The message names the variable and the allowed range — the owner must see
    // what to fix, without reading the source.
    expect(() => dailyBudget("51")).toThrow(/DAILY_BUDGET/);
    expect(() => dailyBudget("51")).toThrow(/1\D+50/);
    expect(() => dailyBudget("51")).toThrow(/got 51/);
  });

  it("rejects non-integer values instead of parsing a prefix", () => {
    for (const raw of ["abc", "7.5", "8abc", "eight", "0x8"]) {
      expect(() => dailyBudget(raw)).toThrow(BudgetConfigError);
    }
  });
});

/**
 * SCORE_DAILY_CAP is the separate daily cap on page downloads + deterministic
 * scoring. It is deliberately NOT DAILY_BUDGET: the judge drops roughly 70% of
 * judged candidates, so a 50-card ceiling needs about 200 scored pages.
 * Publication stays DAILY_BUDGET.
 */
describe("scoreDailyCap (SCORE_DAILY_CAP)", () => {
  it("defaults to 200, not to the publication budget", () => {
    expect(SCORE_DAILY_CAP).toBe(200);
    expect(scoreDailyCap(undefined)).toBe(200);
    expect(scoreDailyCap("")).toBe(200);
    expect(scoreDailyCap("   ")).toBe(200);
    expect(scoreDailyCap("200")).toBe(200);
    // The two limits are independent: a 50-publication day may score 200 pages.
    expect(scoreDailyCap("200")).not.toBe(dailyBudget("50"));
  });

  it("accepts every value of the 8..400 range, including its edges", () => {
    for (let value = SCORE_DAILY_CAP_MIN; value <= SCORE_DAILY_CAP_MAX; value++) {
      expect(scoreDailyCap(String(value))).toBe(value);
    }
    expect(scoreDailyCap("8")).toBe(8);
    expect(scoreDailyCap("400")).toBe(400);
    expect(scoreDailyCap(" 200 ")).toBe(200);
  });

  it("rejects values below 8 and above 400 as a configuration error", () => {
    for (const raw of ["7", "0", "1", "401", "500", "-8"]) {
      expect(() => scoreDailyCap(raw)).toThrow(BudgetConfigError);
    }
    // The message names the variable and the allowed range — the owner must see
    // what to fix without reading the source.
    expect(() => scoreDailyCap("7")).toThrow(/SCORE_DAILY_CAP/);
    expect(() => scoreDailyCap("7")).toThrow(/8\D+400/);
    expect(() => scoreDailyCap("401")).toThrow(/8\D+400/);
  });

  it("rejects non-integer values instead of parsing a prefix", () => {
    for (const raw of ["abc", "40.5", "40abc", "forty", "0x28"]) {
      expect(() => scoreDailyCap(raw)).toThrow(BudgetConfigError);
    }
  });
});

describe("remainingScoreBudget (score slots left in the UTC day)", () => {
  it("keeps scoring after DAILY_BUDGET is spent: 8 of 40 leaves 32 pages", () => {
    expect(remainingScoreBudget(40, 8)).toBe(32);
    expect(remainingScoreBudget(40, 0)).toBe(40);
  });

  it("reaches zero exactly at the cap and never goes negative", () => {
    expect(remainingScoreBudget(40, 40)).toBe(0);
    expect(remainingScoreBudget(40, 41)).toBe(0);
    expect(remainingScoreBudget(0, 0)).toBe(0);
  });
});

function candidate(id: number, score: number | null, confidence: number | null, iso: string): Candidate {
  return { id, score, confidence, publishedAt: iso };
}

/**
 * Budget selection: score desc → confidence desc → publishedAt desc.
 * Owner: «выбирал самые крутые новости», «лучшие по баллу, а не последние».
 */
describe("selectForPublication (best by score, not last by time)", () => {
  it("returns 8 of 20 approved: the highest scores, in descending order", () => {
    const approved = Array.from({ length: 20 }, (_, index) =>
      candidate(index + 1, index + 1, 0.8, `2026-11-10T0${index % 10}:00:00Z`),
    );
    const picked = selectForPublication(approved, 8);
    expect(picked.map((item) => item.id)).toEqual([20, 19, 18, 17, 16, 15, 14, 13]);
  });

  it("breaks an equal score by judge confidence", () => {
    const approved = [
      candidate(1, 60, 0.7, "2026-11-10T10:00:00Z"),
      candidate(2, 60, 0.95, "2026-11-10T09:00:00Z"),
      candidate(3, 60, 0.8, "2026-11-10T11:00:00Z"),
    ];
    expect(selectForPublication(approved, 3).map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it("breaks equal score and confidence by the freshest publication date", () => {
    const approved = [
      candidate(1, 60, 0.9, "2026-11-09T10:00:00Z"),
      candidate(2, 60, 0.9, "2026-11-10T10:00:00Z"),
      candidate(3, 60, 0.9, "2026-11-08T10:00:00Z"),
    ];
    expect(selectForPublication(approved, 3).map((item) => item.id)).toEqual([2, 1, 3]);
  });

  it("keeps the input untouched and never returns more than the budget", () => {
    const approved = [candidate(1, 10, 0.5, "2026-11-10T10:00:00Z")];
    const picked = selectForPublication(approved, 5);
    expect(picked).toHaveLength(1);
    expect(picked).not.toBe(approved);
    expect(selectForPublication(approved, 0)).toEqual([]);
    expect(selectForPublication([], 8)).toEqual([]);
  });

  it("ranks a missing score below any scored candidate and a missing confidence as zero", () => {
    const approved = [
      candidate(1, null, null, "2026-11-10T10:00:00Z"),
      candidate(2, 0, 0.5, "2026-11-10T10:00:00Z"),
    ];
    expect(selectForPublication(approved, 2).map((item) => item.id)).toEqual([2, 1]);
  });
});

/** Cycle counters written to `pipeline_state.metrics` (interfaces.md §10). */
describe("cycle counters", () => {
  it("starts empty with exactly the keys the owner report reads", () => {
    expect(emptyCycleMetrics()).toEqual({
      collected: 0,
      prefiltered: 0,
      judged: 0,
      approved: 0,
      published: 0,
      // Cards approved from a video description alone (origin=youtube-api).
      descriptionOnly: 0,
      rejectedByReason: {},
      usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
    });
  });

  it("normalizes missing or broken jsonb payloads into zeros", () => {
    expect(normalizeCycleMetrics(null)).toEqual(emptyCycleMetrics());
    expect(normalizeCycleMetrics({ collected: "12" })).toEqual(emptyCycleMetrics());
    expect(
      normalizeCycleMetrics({
        collected: 100,
        prefiltered: 40,
        judged: 12,
        approved: 9,
        published: 8,
        rejectedByReason: { "prefilter:no-ai-signal": 60, "judge:off-topic": 28, broken: -3 },
      }),
    ).toEqual({
      collected: 100,
      prefiltered: 40,
      judged: 12,
      approved: 9,
      published: 8,
      descriptionOnly: 0,
      rejectedByReason: { "prefilter:no-ai-signal": 60, "judge:off-topic": 28 },
      usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
    });
  });

  it("merges a second run into the same day: counters and reasons add up, published is absolute", () => {
    const base = mergeCycleMetrics(emptyCycleMetrics(), {
      collected: 100,
      prefiltered: 40,
      judged: 12,
      approved: 8,
      published: 8,
      rejectedByReason: { "prefilter:no-ai-signal": 60 },
      usage: { calls: 12, inputTokens: 1000, outputTokens: 200 },
    });
    const merged = mergeCycleMetrics(base, {
      collected: 10,
      prefiltered: 4,
      judged: 2,
      approved: 0,
      published: 8,
      rejectedByReason: { "prefilter:no-ai-signal": 6, "judge:low-confidence": 2 },
      usage: { calls: 2, inputTokens: 100, outputTokens: 20 },
    });
    expect(merged.collected).toBe(110);
    expect(merged.prefiltered).toBe(44);
    expect(merged.judged).toBe(14);
    expect(merged.approved).toBe(8);
    // Retry-safe: deploying again does not double the published counter.
    expect(merged.published).toBe(8);
    expect(merged.rejectedByReason).toEqual({
      "prefilter:no-ai-signal": 66,
      "judge:low-confidence": 2,
    });
    // Token spend adds up so the report can show the day's cost.
    expect(merged.usage).toEqual({ calls: 14, inputTokens: 1100, outputTokens: 220 });
  });

  it("counts description-only cards separately from approvals, additively", () => {
    const merged = mergeCycleMetrics(
      { ...emptyCycleMetrics(), approved: 3, descriptionOnly: 1 },
      { approved: 2, descriptionOnly: 2 },
    );
    expect(merged.approved).toBe(5);
    expect(merged.descriptionOnly).toBe(3);
    // jsonb may hold anything: a broken value degrades to zero, never NaN.
    expect(normalizeCycleMetrics({ descriptionOnly: "2" }).descriptionOnly).toBe(0);
    expect(normalizeCycleMetrics({ descriptionOnly: 4 }).descriptionOnly).toBe(4);
  });
});

describe("judgeConfidenceOf (ranking input from metrics.judge)", () => {
  it("reads the verdict confidence the judge stored", () => {
    expect(judgeConfidenceOf({ judge: { onTopic: true, confidence: 0.92 } })).toBe(0.92);
    expect(judgeConfidenceOf({ judge: { confidence: 0 } })).toBe(0);
  });

  it("returns null when there is no usable verdict", () => {
    for (const metrics of [
      null,
      undefined,
      {},
      {},
      { judge: null },
      { judge: "yes" },
      { judge: { confidence: "high" } },
      { judge: { confidence: 1.4 } },
      { judge: { confidence: -0.2 } },
    ]) {
      expect(judgeConfidenceOf(metrics)).toBeNull();
    }
  });
});

function ready(id: number, score: number, confidence: number, iso = "2026-11-10T10:00:00Z"): ReadyArticle {
  return { id, title: `#${id}`, score, confidence, publishedAt: iso };
}

/**
 * Publication cap: a direct deploy call cannot push the day over DAILY_BUDGET.
 * There is no "one release per day" gate any more — a card summarized at 17:00
 * goes out at 17:00, and only the remaining daily slots limit the batch
 * (owner: дашборд обновляется сразу, ежедневным остаётся только дайджест).
 * The DB is not involved — the decision is pure.
 */
describe("planPublication (immediate publication within the daily budget)", () => {
  it("publishes every ready article while the day's budget allows", () => {
    const plan = planPublication({
      ready: [ready(1, 70, 0.9), ready(2, 60, 0.8), ready(3, 55, 0.75)],
      budget: 8,
      publishedToday: 0,
    });
    expect(plan.allowed).toBe(true);
    expect(plan.reason).toBeNull();
    expect(plan.items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(plan.remainingBudget).toBe(8);
  });

  it("keeps publication at DAILY_BUDGET even when SCORE_DAILY_CAP is 200", () => {
    const plan = planPublication({
      ready: Array.from({ length: 60 }, (_, index) => ready(index + 1, 100 - index, 0.9)),
      budget: dailyBudget("50"),
      publishedToday: 0,
    });
    expect(scoreDailyCap("200")).toBe(200);
    expect(plan.allowed).toBe(true);
    expect(plan.items).toHaveLength(50);
    expect(plan.items.map((item) => item.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    );
  });

  it("refuses with budget-exhausted when 8 of 8 slots are already published", () => {
    const plan = planPublication({
      ready: [ready(1, 90, 0.99)],
      budget: 8,
      publishedToday: 8,
    });
    expect(plan.allowed).toBe(false);
    expect(plan.reason).toBe("budget-exhausted");
    expect(plan.items).toEqual([]);
    expect(plan.remainingBudget).toBe(0);
  });

  it("publishes only the remaining slots and keeps the best by score", () => {
    const plan = planPublication({
      ready: [ready(1, 50, 0.7), ready(2, 90, 0.95), ready(3, 60, 0.8)],
      budget: 8,
      publishedToday: 6,
    });
    expect(plan.allowed).toBe(true);
    expect(plan.remainingBudget).toBe(2);
    expect(plan.items.map((item) => item.id)).toEqual([2, 3]);
  });

  it("publishes 7 more when 1 of 8 slots is already out", () => {
    const readyArticles = Array.from({ length: 10 }, (_, index) =>
      ready(index + 1, 100 - index, 0.9),
    );
    const plan = planPublication({
      ready: readyArticles,
      budget: 8,
      publishedToday: 1,
    });
    expect(plan.allowed).toBe(true);
    expect(plan.reason).toBeNull();
    expect(plan.remainingBudget).toBe(7);
    expect(plan.items).toHaveLength(7);
    expect(plan.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("respects the batch size on top of the budget", () => {
    const plan = planPublication({
      ready: [ready(1, 90, 0.9), ready(2, 80, 0.9), ready(3, 70, 0.9)],
      budget: 8,
      publishedToday: 0,
      batchSize: 2,
    });
    expect(plan.items.map((item) => item.id)).toEqual([1, 2]);
  });

  it("reports an empty queue instead of publishing nothing silently", () => {
    const plan = planPublication({
      ready: [],
      budget: 8,
      publishedToday: 2,
    });
    expect(plan.allowed).toBe(false);
    expect(plan.reason).toBe("no-ready-articles");
    expect(plan.remainingBudget).toBe(6);
  });

  it("keeps 8 best of 20 ready articles within the budget", () => {
    const readyArticles = Array.from({ length: 20 }, (_, index) =>
      ready(index + 1, index + 1, 0.8),
    );
    const plan = planPublication({
      ready: readyArticles,
      budget: 8,
      publishedToday: 0,
    });
    expect(plan.items.map((item) => item.id)).toEqual([20, 19, 18, 17, 16, 15, 14, 13]);
  });
});

/**
 * The gate is deleted, not hidden: a source guard keeps it from coming back,
 * because the pure test alone passes as soon as the caller stops setting the
 * flag (the old loop set it from `pipeline_state.stage`).
 */
describe("deploy-ready: no one-release-per-day gate", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "deploy-ready.ts"),
    "utf-8",
  );

  it("has no already-published-today refusal and no releaseCommitted input", () => {
    expect(source).not.toContain("already-published-today");
    expect(source).not.toContain("releaseCommitted");
  });
});

/**
 * Operator promise: cards publish as soon as they are summarized, so the loop
 * cycles continuously and pauses LINEAR_WORKER_INTERVAL_MS between cycles
 * instead of sleeping until the next UTC day.
 */
describe("ralph-loop: continuous cycles, no sleep until the next UTC day", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "ralph-loop.sh"),
    "utf-8",
  );

  it("has no wait until the next UTC day", () => {
    expect(source).not.toContain("secs_until_utc_midnight");
    expect(source).not.toMatch(/next UTC day/i);
  });

  it("pauses LINEAR_WORKER_INTERVAL_MS (15 minutes by default) between cycles", () => {
    expect(source).toContain("LINEAR_WORKER_INTERVAL_MS:-900000");
  });

  it("logs the published count and the remaining daily budget", () => {
    expect(source).toContain("remainingBudget");
    expect(source).toMatch(/published today/i);
  });
});

describe("cycleIdFor (one cycle per UTC calendar day)", () => {
  it("uses the UTC date, so a late evening and the next midnight differ", () => {
    expect(cycleIdFor(new Date("2026-11-10T23:59:59Z"))).toBe("cycle-2026-11-10");
    expect(cycleIdFor(new Date("2026-11-10T00:00:00Z"))).toBe("cycle-2026-11-10");
    expect(cycleIdFor(new Date("2026-11-11T00:00:00Z"))).toBe("cycle-2026-11-11");
  });
});

// ─── Stage A → stage B → budget: the candidate's journey ─────────────────────

const CYCLE_NOW = new Date("2026-11-10T12:00:00Z");
/** Fresh (2h old): inside the prefilter's 72h window. */
const CYCLE_PUBLISHED_AT = new Date("2026-11-10T10:00:00Z");
/** Only exists in the fetched page body — it must never reach the judge. */
const PAGE_ONLY_MARKER = "PAGE-ONLY-MARKER: quantum chemistry breakthrough in the fuel cell lab";

function newsCandidate(index: number, overrides: Partial<EvaluationCandidate> = {}): EvaluationCandidate {
  return {
    id: index,
    title: `AI model ${index} sets a new reasoning benchmark`,
    lead: `An AI lab reports that model ${index} improves step-by-step reasoning on public tests.`,
    originalUrl: `https://example.org/news/${index}`,
    source: "example-news",
    publishedAt: CYCLE_PUBLISHED_AT,
    isScience: false,
    language: "en",
    section: "ai-news",
    sphereTags: [],
    metrics: { origin: "rss", hasDescription: true },
    ...overrides,
  };
}

/**
 * The judge asks two questions: a verdict over the article and an independent
 * review of that verdict. The fake answers both, so the test sees the real
 * judge contract (title + lead only, no page text).
 */
function verdictReply(confidence: number, provider = "gigachat", model = "GigaChat") {
  return async (args: { messages: { role: string; content: string }[] }) => {
    const user = args.messages[1]?.content ?? "";
    const text = user.includes("Первый судья вынес вердикт")
      ? JSON.stringify({ agree: true, confidence: 0.95, reason: "подтверждаю" })
      : JSON.stringify({
          onTopic: true,
          section: "ai-news",
          direction: null,
          confidence,
          reason: "AI-модель и её бенчмарк",
        });
    return { text, provider, model, usage: { inputTokens: 100, outputTokens: 20 } };
  };
}

function isReviewPrompt(user: string): boolean {
  return user.includes("Первый судья вынес вердикт");
}

describe("evaluate-news cycle: page download only for the day budget", () => {
  it("fetches at most DAILY_BUDGET × 3 pages for 100 candidates with budget 8", async () => {
    // Every request fails fast: the test counts calls, it does not read pages.
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const candidates = Array.from({ length: 100 }, (_, index) => newsCandidate(index + 1));
      const result = await runEvaluationCycle({
        candidates,
        budget: 8,
        deps: {
          now: CYCLE_NOW,
          // Higher confidence for higher ids, so the top 8 are ids 93..100.
          completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
            const user = args.messages[1].content;
            if (isReviewPrompt(user)) return verdictReply(0.95)(args);
            const id = Number(user.match(/model (\d+)/)?.[1] ?? "0");
            return verdictReply(0.7 + id / 1000)(args);
          }) as never,
        },
      });

      expect(result.scored).toBe(8);
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(8);
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(8 * 3);

      const scored = result.outcomes.filter((outcome) => outcome.decision !== "deferred-budget");
      expect(scored).toHaveLength(8);
      expect(scored.map((outcome) => outcome.candidate.id)).toEqual([93, 94, 95, 96, 97, 98, 99, 100]);
      // The rest keep the verdict and wait for a later cycle: no page, no score.
      expect(result.outcomes.filter((outcome) => outcome.decision === "deferred-budget")).toHaveLength(92);
      expect(result.counters.collected).toBe(100);
      expect(result.counters.prefiltered).toBe(100);
      expect(result.counters.judged).toBe(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("evaluate-news cycle: SCORE_DAILY_CAP, not DAILY_BUDGET, bounds scoring", () => {
  it("keeps scoring at scoredToday=8 when the score cap is 40", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1), newsCandidate(2), newsCandidate(3)],
      // The regression: 8 scored today is exactly the publication budget, but
      // only a fifth of the 40-page score cap.
      budget: remainingScoreBudget(scoreDailyCap("40"), 8),
      deps: {
        now: CYCLE_NOW,
        completeJson: verdictReply(0.9) as never,
        score: async (item) => ({
          id: item.id,
          title: item.title,
          score: 60,
          breakdown: [],
          metrics: {},
        }),
      },
    });
    expect(result.scored).toBe(3);
    expect(result.outcomes.every((outcome) => outcome.decision !== "deferred-budget")).toBe(true);
    expect(result.counters.approved).toBe(3);
  });

  it("stops at scoredToday=40 with score-cap-reached, not download-budget", async () => {
    let scored = 0;
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1)],
      budget: remainingScoreBudget(scoreDailyCap("40"), 40),
      deps: {
        now: CYCLE_NOW,
        completeJson: verdictReply(0.9) as never,
        score: async (item) => {
          scored++;
          return { id: item.id, title: item.title, score: 60, breakdown: [], metrics: {} };
        },
      },
    });
    expect(scored).toBe(0);
    expect(result.scored).toBe(0);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].decision).toBe("deferred-budget");
    expect(result.outcomes[0].metrics.deferReason).toBe("score-cap-reached");
    expect(result.outcomes[0].metrics.deferReason).not.toBe("download-budget");
  });
});

describe("evaluate-news cycle: judge only after the prefilter, verdict in metrics.judge", () => {
  it("calls the judge only for candidates that passed the prefilter", async () => {
    const judgedTitles: string[] = [];
    const candidates = Array.from({ length: 100 }, (_, index) =>
      index < 40
        ? newsCandidate(index + 1, {
            title: `Weekly weather report number ${index + 1}`,
            lead: "Sunny spells and mild winds are expected across the region this weekend.",
          })
        : newsCandidate(index + 1),
    );
    const result = await runEvaluationCycle({
      candidates,
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
          const user = args.messages[1].content;
          if (isReviewPrompt(user)) return verdictReply(0.95)(args);
          judgedTitles.push(user);
          return verdictReply(0.9)(args);
        }) as never,
        // Scoring is not under test here: no network at all.
        score: async (item) => ({
          id: item.id,
          title: item.title,
          score: 60,
          breakdown: [],
          metrics: {},
        }),
      },
    });
    expect(result.judgeCalls).toBe(60);
    expect(judgedTitles).toHaveLength(60);
    expect(judgedTitles.every((content) => !content.includes("Weekly weather report"))).toBe(true);

    const rejected = result.outcomes.filter((outcome) => outcome.decision === "rejected-prefilter");
    expect(rejected).toHaveLength(40);
    expect(rejected[0].metrics.prefilter).toMatchObject({ keep: false, reason: "no-ai-signal" });
    expect(result.counters.rejectedByReason["prefilter:no-ai-signal"]).toBe(40);
    // No page was paid for: the day's download ledger must not count it.
    expect(rejected[0].metrics).not.toHaveProperty("scoredAt");
  });

  it("marks the download in metrics.scoredAt so the day's allowance is countable", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(11)],
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: verdictReply(0.9) as never,
        score: async (item) => ({ id: item.id, title: item.title, score: 60, breakdown: [], metrics: {} }),
      },
    });
    expect(result.outcomes[0].metrics.scoredAt).toBe("2026-11-10T12:00:00.000Z");
    expect(result.outcomes[0].metrics.evaluatedAt).toBe("2026-11-10T12:00:00.000Z");
  });

  it("stores every verdict field, including which provider answered", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(7)],
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: verdictReply(0.91) as never,
        score: async (item) => ({ id: item.id, title: item.title, score: 60, breakdown: [], metrics: {} }),
      },
    });
    const outcome = result.outcomes[0];
    expect(outcome.decision).toBe("approved");
    expect(outcome.metrics.judge).toEqual({
      onTopic: true,
      section: "ai-news",
      direction: null,
      confidence: 0.91,
      reason: "AI-модель и её бенчмарк",
      provider: "gigachat",
      model: "GigaChat",
    });
    expect(result.counters.approved).toBe(1);
  });

  it("never sends the downloaded page to the judge, only title and saved lead", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(`<html><body><p>${PAGE_ONLY_MARKER}</p></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runEvaluationCycle({
        candidates: [newsCandidate(1, { lead: "The saved RSS description of an AI benchmark story." })],
        budget: 8,
        deps: {
          now: CYCLE_NOW,
          completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
            seen.push(...args.messages.map((message) => message.content));
            return verdictReply(0.9)(args);
          }) as never,
        },
      });
      const prompt = seen.join("\n");
      expect(prompt).toContain("AI model 1 sets a new reasoning benchmark");
      expect(prompt).toContain("The saved RSS description of an AI benchmark story.");
      expect(prompt).not.toContain("PAGE-ONLY-MARKER");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("evaluate-news cycle: provider failure", () => {
  it("keeps the candidates pending and counts the provider class, not a verdict", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1), newsCandidate(2), newsCandidate(3)],
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: (async () => {
          throw new ProviderError("gigachat", "config", "invalid key", { status: 401 });
        }) as never,
      },
    });
    expect(result.scored).toBe(0);
    expect(result.counters.approved).toBe(0);
    expect(result.counters.judged).toBe(0);
    // The material was never judged: the cause is the provider, not the topic.
    expect(result.counters.rejectedByReason["provider:config"]).toBe(3);
    expect(result.counters.rejectedByReason["judge:invalid-judgement"]).toBeUndefined();
    expect(result.providerErrors).toEqual(["config"]);
    for (const outcome of result.outcomes) {
      expect(outcome.decision).toBe("provider-error");
      expect(outcome.metrics).not.toHaveProperty("judge");
      // No verdict was paid for or persisted, so the row stays pending.
      const update = updateForOutcome(outcome);
      expect(update).not.toHaveProperty("status");
      expect(update).not.toHaveProperty("score");
    }
  });
});

describe("collect-dual: the RSS lead survives collection", () => {
  const resolution = { isScience: false, scienceField: null, section: "ai-news", sphereTags: [] } as const;

  it("stores the collected description in news.summary", () => {
    const row = buildNewsRow(
      {
        title: "AI model beats baselines",
        url: "https://example.org/a",
        source: "example-news",
        publishedAt: CYCLE_PUBLISHED_AT,
        language: "en",
        isScience: false,
        scienceField: null,
        description: "The abstract that the judge must read.",
        metrics: { origin: "rss" },
      },
      { ...resolution, sphereTags: [] },
    );
    expect(row.summary).toBe("The abstract that the judge must read.");

    const withoutDescription = buildNewsRow(
      {
        title: "AI model beats baselines",
        url: "https://example.org/b",
        source: "example-news",
        publishedAt: CYCLE_PUBLISHED_AT,
        language: "en",
        isScience: false,
        scienceField: null,
        metrics: { origin: "rss" },
      },
      { ...resolution, sphereTags: [] },
    );
    expect(withoutDescription.summary).toBe("");
  });

  it("passes the stored description through to the judge", async () => {
    const row = buildNewsRow(
      {
        title: "AI model beats baselines",
        url: "https://example.org/a",
        source: "example-news",
        publishedAt: CYCLE_PUBLISHED_AT,
        language: "en",
        isScience: false,
        scienceField: null,
        description: "The abstract that the judge must read.",
        metrics: { origin: "rss" },
      },
      { ...resolution, sphereTags: [] },
    );
    const prompts: string[] = [];
    await runEvaluationCycle({
      candidates: [
        {
          id: 1,
          title: row.title,
          lead: row.summary ?? "",
          originalUrl: row.originalUrl,
          source: row.source,
          publishedAt: row.publishedAt,
          isScience: false,
          metrics: row.metrics,
        },
      ],
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
          prompts.push(args.messages[1].content);
          return verdictReply(0.9)(args);
        }) as never,
        score: async (item) => ({ id: item.id, title: item.title, score: 60, breakdown: [], metrics: {} }),
      },
    });
    expect(prompts[0]).toContain("The abstract that the judge must read.");
  });
});

describe("manifest-gen: the budget caps what gets summarized", () => {
  it("gives the 8 best of 20 approved articles, not the last 8", () => {
    const approved = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      score: index + 1,
      publishedAt: new Date(`2026-11-10T0${index % 10}:00:00Z`),
      metrics: { judge: { onTopic: true, confidence: 0.8 } },
    }));
    const selected = applyDailyBudget(approved, 8);
    expect(selected).toHaveLength(8);
    expect(selected.map((article) => article.id)).toEqual([20, 19, 18, 17, 16, 15, 14, 13]);
  });

  it("uses the judge confidence when scores are equal", () => {
    const approved = [
      { id: 1, score: 70, publishedAt: new Date("2026-11-10T08:00:00Z"), metrics: { judge: { confidence: 0.72 } } },
      { id: 2, score: 70, publishedAt: new Date("2026-11-10T07:00:00Z"), metrics: { judge: { confidence: 0.97 } } },
      { id: 3, score: 70, publishedAt: new Date("2026-11-10T09:00:00Z"), metrics: { judge: { confidence: 0.81 } } },
    ];
    expect(applyDailyBudget(approved, 2).map((article) => article.id)).toEqual([2, 3]);
  });
});

/**
 * The migration artifact is the deliverable; without a live Postgres in the
 * test environment the only automatable guard is that the journal registers
 * 0011 and that its SQL adds the column `readCycle` writes to.
 */
describe("migration 0011 (pipeline_state.metrics)", () => {
  it("registers 0011 in the journal and adds the metrics column", () => {
    const migrationsDir = path.resolve(import.meta.dirname, "../../db/migrations");
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf-8"),
    ) as { entries: { idx: number; tag: string }[] };
    const entry = journal.entries.find((item) => item.tag.startsWith("0011"));
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(11);

    const sql = fs.readFileSync(path.join(migrationsDir, `${entry!.tag}.sql`), "utf-8");
    expect(sql).toMatch(/ALTER TABLE "pipeline_state" ADD COLUMN "metrics" jsonb/);

    const prefix = entry!.tag.split("_")[0];
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, `meta/${prefix}_snapshot.json`), "utf-8"),
    ) as { tables: Record<string, { columns: Record<string, unknown> }> };
    expect(snapshot.tables["public.pipeline_state"].columns).toHaveProperty("metrics");
  });
});
