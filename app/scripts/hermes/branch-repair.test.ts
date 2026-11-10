import { describe, expect, it, vi } from "vitest";
import {
  createProviderChain,
} from "../../api/ai/providers/chain";
import {
  ProviderError,
  type ChatResult,
  type CompleteJson,
  type Provider,
  type ProviderId,
} from "../../api/ai/providers/types";
import {
  runEvaluationCycle,
  updateForOutcome,
  type EvaluationCandidate,
} from "./evaluate-news";
import { summarizeWithChain, summarySectionUpdate } from "./save-summary";
import { buildOwnerReport } from "./digest-format";
import { ownerStatsFromCycle } from "./daily-digest";
import { emptyCycleMetrics } from "./publish-budget";

/**
 * F1 — repair of the branch after the common code review.
 *
 * Covers exactly the five `fix now` findings:
 *   1. summaries go through the provider chain and their usage is accounted;
 *   2. a provider failure is not turned into a rejected candidate;
 *   3. a judged row keeps the judge's section / direction / spheres;
 *   4. the owner report reads `pipeline_state.metrics` (usage + rejection split);
 *   5. the chain falls back only on quota/transient, never on content/config.
 */

const CYCLE_NOW = new Date("2026-11-10T12:00:00Z");
/** Fresh (2h old): inside the prefilter's 72h window. */
const CYCLE_PUBLISHED_AT = new Date("2026-11-10T10:00:00Z");

function newsCandidate(
  index: number,
  overrides: Partial<EvaluationCandidate> = {},
): EvaluationCandidate {
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

function answer(provider: ProviderId, text: string): ChatResult {
  return {
    text,
    provider,
    model: `${provider}-model`,
    usage: { inputTokens: 40, outputTokens: 10 },
  };
}

function fakeProvider(id: ProviderId, completeJson: CompleteJson): Provider {
  return { id, completeJson };
}

/** The judge asks two questions: first the verdict, then an independent review. */
function judgeReply(
  section: "ai-news" | "science" | "invention-tools",
  direction: string | null,
  confidence = 0.92,
) {
  return async (args: { messages: { role: string; content: string }[] }) => {
    const user = args.messages[1]?.content ?? "";
    const text = user.includes("Первый судья вынес вердикт")
      ? JSON.stringify({ agree: true, confidence: 0.95, reason: "подтверждаю" })
      : JSON.stringify({
          onTopic: true,
          section,
          direction,
          confidence,
          reason: "Материал про названную тему",
        });
    return answer("gigachat", text);
  };
}

// ─── 5. Chain: fallback only on quota / transient (R14, spec §5) ────────────

describe("provider chain: fallback only on quota/transient", () => {
  it("does not fall back on a content error (a 400/404 from GigaChat)", async () => {
    const opencode = vi.fn(async () => answer("opencode", "should not be used"));
    const chain = createProviderChain({
      providers: [
        fakeProvider(
          "gigachat",
          async () => {
            throw new ProviderError("gigachat", "content", "model not found", { status: 404 });
          },
        ),
        fakeProvider("opencode", opencode),
      ],
    });

    await expect(
      chain.completeJson({ messages: [{ role: "user", content: "Текст" }] }),
    ).rejects.toMatchObject({ name: "ProviderError", errorClass: "content", provider: "gigachat" });
    expect(opencode).not.toHaveBeenCalled();
    expect(chain.lastProvider()).toBeNull();
  });

  it("does not fall back on a config error, but does on quota", async () => {
    const configFallback = vi.fn(async () => answer("opencode", "unused"));
    const configChain = createProviderChain({
      providers: [
        fakeProvider("gigachat", async () => {
          throw new ProviderError("gigachat", "config", "invalid key", { status: 401 });
        }),
        fakeProvider("opencode", configFallback),
      ],
    });
    await expect(
      configChain.completeJson({ messages: [{ role: "user", content: "Текст" }] }),
    ).rejects.toMatchObject({ errorClass: "config" });
    expect(configFallback).not.toHaveBeenCalled();

    const quotaChain = createProviderChain({
      providers: [
        fakeProvider("gigachat", async () => {
          throw new ProviderError("gigachat", "quota", "rate limit", { status: 429 });
        }),
        fakeProvider("opencode", async () => answer("opencode", "fallback answer")),
      ],
    });
    const result = await quotaChain.completeJson({ messages: [{ role: "user", content: "Текст" }] });
    expect(result.provider).toBe("opencode");
    expect(result.text).toBe("fallback answer");
  });
});

// ─── 2. A provider failure is not a verdict (R14, R17) ──────────────────────

describe("evaluate-news: provider failure keeps candidates pending", () => {
  it("does not turn a config failure into invalid-judgement", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(1), newsCandidate(2)],
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
    // The cause is the provider, not the material: `provider:<class>` counter.
    expect(result.counters.rejectedByReason["provider:config"]).toBeGreaterThan(0);
    expect(result.counters.rejectedByReason["judge:invalid-judgement"]).toBeUndefined();
    // No verdict means no persisted judge block, so no "rejected" decision.
    for (const outcome of result.outcomes) {
      expect(outcome.decision).toBe("provider-error");
      expect(outcome.verdict).toBeNull();
      expect(outcome.metrics).not.toHaveProperty("judge");
    }
    expect(result.providerErrors).toEqual(["config"]);
  });

  it("names the class of a quota failure during the reviewer call", async () => {
    let calls = 0;
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(3)],
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
          calls++;
          if (calls === 1) return judgeReply("ai-news", null)(args);
          throw new ProviderError("gigachat", "quota", "rate limit", { status: 429 });
        }) as never,
      },
    });

    expect(result.counters.rejectedByReason["provider:quota"]).toBe(1);
    expect(result.counters.rejectedByReason["judge:rejected-by-review"]).toBeUndefined();
    expect(result.outcomes[0].decision).toBe("provider-error");
    expect(result.outcomes[0].metrics).not.toHaveProperty("judge");
    expect(result.providerErrors).toEqual(["quota"]);
  });
});

// ─── 3. Judged rows keep the judge's placement (R07.1) ─────────────────────

describe("evaluate-news: the card is placed by the judge, not by resolveSection", () => {
  it("writes section/scienceField/sphereTags from metrics.judge", async () => {
    const result = await runEvaluationCycle({
      // The title is an AI-benchmark story: a word-matching router would file
      // it under "ИИ-новости". The judge says it is AI for biology instead.
      candidates: [newsCandidate(1)],
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: judgeReply("science", "biology") as never,
        score: async (item) => ({
          id: item.id,
          title: item.title,
          score: 60,
          breakdown: [],
          metrics: {},
          // A stale word-matching placement: the judge's verdict must win.
          section: "ai-news",
          sphereTags: ["word-match"],
          isScience: false,
          scienceField: null,
        }),
      },
    });
    const outcome = result.outcomes[0];
    expect(outcome.decision).toBe("approved");
    expect(outcome.metrics.judge).toMatchObject({ section: "science", direction: "biology" });

    const update = updateForOutcome(outcome);
    expect(update.section).toBe("science");
    expect(update.scienceField).toBe("biology");
    expect(update.isScience).toBe(true);
    expect(update.sphereTags).toEqual([]);
  });

  it("derives invention-tool spheres from the judge's direction", async () => {
    const result = await runEvaluationCycle({
      candidates: [newsCandidate(2)],
      budget: 8,
      deps: {
        now: CYCLE_NOW,
        completeJson: judgeReply("invention-tools", "chemistry") as never,
        score: async (item) => ({
          id: item.id,
          title: item.title,
          score: 70,
          breakdown: [],
          metrics: {},
          section: "ai-news",
          sphereTags: ["word-match"],
          isScience: false,
          scienceField: null,
        }),
      },
    });

    const update = updateForOutcome(result.outcomes[0]);
    expect(update.section).toBe("invention-tools");
    expect(update.sphereTags).toEqual(["chemistry"]);
    expect(update.scienceField).toBeNull();
    expect(update.isScience).toBe(false);
  });
});

describe("save-summary: a judged row is not re-routed by the Russian summary", () => {
  it("returns no section update for a row the judge already accepted", () => {
    const update = summarySectionUpdate({
      metrics: {
        judge: {
          onTopic: true,
          section: "science",
          direction: "biology",
          confidence: 0.92,
          reason: "Нейросеть предсказала структуру белка",
        },
      },
      title: "Нейросеть предсказала структуру белка",
      // The generated summary happens to contain invention/chemistry words:
      // re-routing on them would overrule the judge with a word match.
      summary: "Инструмент для изобретений в химии на основе ИИ.",
      content: "Изобретение и химия.",
      currentSection: "science",
    });

    expect(update).toBeNull();
  });

  it("still routes a row the judge has not accepted", () => {
    const update = summarySectionUpdate({
      metrics: { judge: { onTopic: false, reason: "off-topic" } },
      title: "Нейросеть научилась читать спектры крови для ранней диагностики рака",
      summary: "Модель машинного обучения находит онкологические маркеры в анализах пациентов.",
      content: "",
      currentSection: "ai-news",
    });

    expect(update).not.toBeNull();
    expect(update?.sphereTags).toEqual(expect.any(Array));
    expect(update?.isScience).toBe(true);
    expect(update?.scienceField).not.toBeNull();
  });
});

// ─── 1. Summaries go through the provider chain (R12) ─────────────────────

const SUMMARY_TITLE = "New AI model predicts protein structures";
const SUMMARY_CONTENT = "The neural network predicts folding of a large protein complex in cells.";
const SUMMARY_JSON = JSON.stringify({
  title_ru: "Новая ИИ-модель предсказывает структуру белков",
  summary: "Модель точнее прежних методов предсказывает укладку белков в клетке.",
});

describe("save-summary: the summary is written by the provider chain", () => {
  it("asks the chain and parses the same JSON shape", async () => {
    const calls: { role: string; content: string }[][] = [];
    const completeJson: CompleteJson = async (args) => {
      calls.push(args.messages);
      return answer("gigachat", `\`\`\`json\n${SUMMARY_JSON}\n\`\`\``);
    };

    const draft = await summarizeWithChain(
      { title: SUMMARY_TITLE, content: SUMMARY_CONTENT, source: "nature" },
      completeJson,
    );

    expect(draft).toMatchObject({
      titleRu: "Новая ИИ-модель предсказывает структуру белков",
      summary: "Модель точнее прежних методов предсказывает укладку белков в клетке.",
      provider: "gigachat",
      model: "gigachat-model",
    });
    expect(draft.usage).toEqual({ inputTokens: 40, outputTokens: 10 });

    const prompt = calls[0].map((message) => message.content).join("\n");
    expect(prompt).toContain("--- BEGIN ARTICLE (UNTRUSTED) ---");
    expect(prompt).toContain("--- END ARTICLE ---");
    expect(prompt).toContain(SUMMARY_TITLE);
    expect(prompt).toContain(SUMMARY_CONTENT);
  });

  it("counts the summary spend through the chain usage sink", async () => {
    const sink = vi.fn();
    const chain = createProviderChain({
      providers: [fakeProvider("gigachat", async () => answer("gigachat", SUMMARY_JSON))],
      usageSink: sink,
    });

    await summarizeWithChain(
      { title: SUMMARY_TITLE, content: SUMMARY_CONTENT, source: "nature" },
      chain.completeJson,
    );

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gigachat",
        model: "gigachat-model",
        inputTokens: 40,
        outputTokens: 10,
      }),
    );
  });

  it("surfaces a provider failure with its class instead of a substituted summary", async () => {
    const completeJson: CompleteJson = async () => {
      throw new ProviderError("gigachat", "config", "invalid key", { status: 401 });
    };

    await expect(
      summarizeWithChain({ title: SUMMARY_TITLE, content: SUMMARY_CONTENT, source: "nature" }, completeJson),
    ).rejects.toMatchObject({ name: "ProviderError", errorClass: "config", provider: "gigachat" });
  });

  it("treats an answer without the expected JSON as a content failure", async () => {
    const completeJson: CompleteJson = async () => answer("gigachat", "Не могу ответить.");

    await expect(
      summarizeWithChain({ title: SUMMARY_TITLE, content: SUMMARY_CONTENT, source: "nature" }, completeJson),
    ).rejects.toMatchObject({ name: "ProviderError", errorClass: "content" });
  });
});

// ─── 4. Owner report reads the day's cycle ledger (R13, R18) ───────────────

describe("owner report: usage and rejection split from pipeline_state.metrics", () => {
  const cycleMetrics = {
    collected: 100,
    prefiltered: 40,
    judged: 30,
    approved: 8,
    published: 8,
    rejectedByReason: {
      "prefilter:no-ai-signal": 55,
      "prefilter:stale": 5,
      "judge:low-confidence": 8,
      "judge:off-topic": 2,
      "provider:config": 1,
    },
    usage: { calls: 9, inputTokens: 12345, outputTokens: 678 },
  };

  it("derives collected, the prefilter/judge split, usage and provider errors", () => {
    const fields = ownerStatsFromCycle(cycleMetrics);

    expect(fields.collected).toBe(100);
    // 55 + 5 rejected before the expensive stage, 8 + 2 by the judge.
    expect(fields.rejectedByPrefilter).toBe(60);
    expect(fields.rejectedByJudge).toBe(10);
    expect(fields.usage).toEqual({ calls: 9, inputTokens: 12345, outputTokens: 678 });
    expect(fields.providerErrors).toEqual(["config"]);
  });

  it("prints usage and the rejection split in the owner message", () => {
    const fields = ownerStatsFromCycle(cycleMetrics);
    const report = buildOwnerReport(
      {
        collected: fields.collected,
        rejected: 92,
        published: 8,
        rejectedByPrefilter: fields.rejectedByPrefilter,
        rejectedByJudge: fields.rejectedByJudge,
        rejectedByReason: cycleMetrics.rejectedByReason,
        usage: fields.usage,
        errors: fields.providerErrors.map((errorClass) => `ошибка провайдера: ${errorClass}`),
      },
      { date: new Date("2026-11-10T10:00:00Z"), dashboardUrl: "https://example.org" },
    );

    expect(report).toContain("Отсеяно префильтром: 60 · судьёй: 10");
    expect(report).toContain("Токены за сутки: 9 вызовов");
    expect(report).toContain("вход 12345");
    expect(report).toContain("выход 678");
    // The owner learns it was the provider, not the materials (R14/R17).
    expect(report).toContain("ошибка провайдера: config");
  });

  it("prints a zero usage line for a day with no calls instead of omitting it", () => {
    const fields = ownerStatsFromCycle(emptyCycleMetrics());
    const report = buildOwnerReport(
      {
        collected: 0,
        rejected: 0,
        published: 0,
        rejectedByPrefilter: fields.rejectedByPrefilter,
        rejectedByJudge: fields.rejectedByJudge,
        rejectedByReason: {},
        usage: fields.usage,
      },
      { date: new Date("2026-11-10T10:00:00Z"), dashboardUrl: "https://example.org" },
    );
    expect(report).toContain("Токены за сутки: 0 вызовов");
  });
});
