/**
 * youtube-description-only.test.ts — videos ingested by the official YouTube
 * Data API are judged and summarized on their title + description.
 *
 * Why: on the production host youtube.com is blocked by hostname while
 * youtube.googleapis.com answers, so yt-dlp can never reach a video to pull a
 * transcript. The API gives title, description and date — enough for the topic
 * judge — but the evaluator used to reject every such video with
 * `transcript-unavailable` (score 0) and the collected material died.
 *
 * Contract under test:
 *   - `metrics.origin === "youtube-api"` means "description is enough": no
 *     yt-dlp call, `metrics.transcript = "unavailable-description-only"`, the
 *     candidate reaches the judge on title + description and is not refused for
 *     a missing transcript;
 *   - ordinary videos (origin `youtube-rss` / legacy source) keep the exact old
 *     transcript behaviour;
 *   - save-summary writes the card from the description, tells the model the
 *     text is short and invention is forbidden, and refuses a description below
 *     200 characters (`description-too-short`) instead of publishing a guess.
 *
 * yt-dlp is mocked whole: the suite proves the wiring and never spawns a
 * process or touches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transcriptMock = vi.hoisted(() => ({ fetchYoutubeTranscript: vi.fn() }));

vi.mock("./youtube-transcript", () => ({
  fetchYoutubeTranscript: transcriptMock.fetchYoutubeTranscript,
  isYoutubeUrl: (url: string) => /youtube\.com|youtu\.be/.test(url),
}));

import {
  runEvaluationCycle,
  updateForOutcome,
  type EvaluationCandidate,
} from "./evaluate-news";
import { SCORE_GATE } from "./pipeline-config";
import {
  DESCRIPTION_ONLY_TRANSCRIPT,
  isDescriptionOnlyVideo,
  scoreYoutubeCandidate,
} from "./youtube-policy";
import {
  DESCRIPTION_ONLY_MIN_CHARS,
  descriptionOnlyMaterial,
  summarizeWithChain,
} from "./save-summary";
import type { CompleteJson } from "../../api/ai/providers/types";

const NOW = new Date("2026-11-15T12:00:00Z");
const PUBLISHED_AT = new Date("2026-11-15T09:00:00Z");

/** Above the 200-character floor: a real description of a real video. */
const LONG_DESCRIPTION =
  "In this episode we look at LLM agents: how a model plans its steps, calls tools " +
  "and checks the result before it answers. We show where agents fail on long tasks " +
  "and why long-context tests matter more than leaderboard numbers. Timestamps and " +
  "links to the papers are in the description below.";

const SHORT_DESCRIPTION = "A short note about our new demo.";

function apiCandidate(overrides: Partial<EvaluationCandidate> = {}): EvaluationCandidate {
  return {
    id: 1,
    title: "LLM agents that plan and call tools",
    lead: LONG_DESCRIPTION,
    originalUrl: "https://www.youtube.com/watch?v=apiVideo42",
    source: "youtube-two-minute-papers",
    publishedAt: PUBLISHED_AT,
    isScience: false,
    language: "en",
    section: "ai-news",
    sphereTags: [],
    // Exactly what `buildYoutubeApiCandidate` writes for a Data API upload.
    metrics: { origin: "youtube-api", videoId: "apiVideo42", durationSeconds: 615 },
    ...overrides,
  };
}

function rssCandidate(overrides: Partial<EvaluationCandidate> = {}): EvaluationCandidate {
  return {
    id: 2,
    title: "Large language model agents in production",
    lead: "A talk about deploying LLM agents and the tooling around them.",
    originalUrl: "https://www.youtube.com/watch?v=legacy42",
    source: "youtube-two-minute-papers",
    publishedAt: PUBLISHED_AT,
    isScience: false,
    language: "en",
    section: "ai-news",
    sphereTags: [],
    metrics: { origin: "youtube-rss", collectionTab: "feed" },
    ...overrides,
  };
}

/**
 * The judge asks twice: a verdict over the article and an independent review of
 * it. This fake answers both, so the tests observe the real judge contract.
 */
function verdictReply(confidence = 0.9) {
  return async (args: { messages: { role: string; content: string }[] }) => {
    const user = args.messages[1]?.content ?? "";
    const text = user.includes("Первый судья вынес вердикт")
      ? JSON.stringify({ agree: true, confidence: 0.95, reason: "подтверждаю" })
      : JSON.stringify({
          onTopic: true,
          section: "ai-news",
          direction: null,
          confidence,
          reason: "LLM-агенты и их инструменты",
        });
    return {
      text,
      provider: "gigachat",
      model: "GigaChat",
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  transcriptMock.fetchYoutubeTranscript.mockReset();
  fetchMock = vi.fn(async () => new Response("", { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Evaluation: description-only is enough ─────────────────────────────────

describe("evaluate-news: origin=youtube-api is judged on title + description", () => {
  it("approves an API video without calling yt-dlp or fetching a page", async () => {
    const result = await runEvaluationCycle({
      candidates: [apiCandidate()],
      budget: 8,
      deps: { now: NOW, completeJson: verdictReply() as never },
    });

    const outcome = result.outcomes[0];
    expect(transcriptMock.fetchYoutubeTranscript).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.decision).toBe("approved");
    expect(outcome.result?.score).toBeGreaterThanOrEqual(SCORE_GATE);

    // The transcript is marked unavailable BY DESIGN, not as a refusal.
    expect(outcome.metrics.transcript).toBe(DESCRIPTION_ONLY_TRANSCRIPT);
    expect(DESCRIPTION_ONLY_TRANSCRIPT).toBe("unavailable-description-only");
    expect(outcome.metrics.youtubePreflight).toMatchObject({
      eligible: true,
      reason: "description-only",
    });
    expect(outcome.metrics.youtubePreflight).not.toMatchObject({
      reason: "transcript-unavailable",
    });
    // The card is real: it has a score and a status to be summarized later.
    const update = updateForOutcome(outcome);
    expect(update.score).toBe(outcome.result?.score);
    expect(update).not.toHaveProperty("status");
    // The description is stored as preflight content: ralph-loop.sh then skips
    // fetch-article.ts for this row, which is the only other yt-dlp call site.
    expect(outcome.result?.originalContent).toContain(LONG_DESCRIPTION);
    expect((outcome.result?.originalContent ?? "").length).toBeGreaterThanOrEqual(100);
    expect(update.originalContent).toBe(outcome.result?.originalContent);
    // No refusal of this row is counted for a missing transcript.
    expect(JSON.stringify(result.counters.rejectedByReason)).not.toContain("transcript");
    expect(result.counters.approved).toBe(1);
    expect(result.counters.descriptionOnly).toBe(1);
  });

  it("judges the description when the AI signal lives only there", async () => {
    const prompts: string[] = [];
    const result = await runEvaluationCycle({
      candidates: [
        apiCandidate({
          title: "A new way to teach a model to plan its steps",
        }),
      ],
      budget: 8,
      deps: {
        now: NOW,
        completeJson: (async (args: { messages: { role: string; content: string }[] }) => {
          prompts.push(args.messages[1]?.content ?? "");
          return verdictReply()(args);
        }) as never,
      },
    });

    expect(result.outcomes[0].decision).toBe("approved");
    // The judge saw the stored description, not an empty lead.
    expect(prompts.join("\n")).toContain("how a model plans its steps");
    expect(result.counters.descriptionOnly).toBe(1);
  });

  it("still drops an API video with no AI signal in title or description", async () => {
    const result = await runEvaluationCycle({
      candidates: [
        apiCandidate({
          title: "How I rebuilt my cabin roof",
          lead: "A weekend project about wood, paint and a new ladder for the shed.",
        }),
      ],
      budget: 8,
      deps: { now: NOW, completeJson: verdictReply() as never },
    });

    expect(result.outcomes[0].decision).toBe("rejected-prefilter");
    expect(result.counters.rejectedByReason["prefilter:no-ai-signal"]).toBe(1);
    expect(result.counters.descriptionOnly).toBe(0);
    expect(transcriptMock.fetchYoutubeTranscript).not.toHaveBeenCalled();
  });
});

// ─── Ordinary videos keep the old behaviour ─────────────────────────────────

describe("evaluate-news: ordinary YouTube videos keep the transcript requirement", () => {
  it("refuses a legacy video whose transcript is unavailable", async () => {
    transcriptMock.fetchYoutubeTranscript.mockResolvedValue(null);
    const result = await runEvaluationCycle({
      candidates: [rssCandidate()],
      budget: 8,
      deps: { now: NOW, completeJson: verdictReply() as never },
    });

    const outcome = result.outcomes[0];
    expect(transcriptMock.fetchYoutubeTranscript).toHaveBeenCalledTimes(1);
    expect(transcriptMock.fetchYoutubeTranscript).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=legacy42",
    );
    expect(outcome.decision).toBe("rejected-low-score");
    expect(outcome.metrics.youtubePreflight).toMatchObject({
      eligible: false,
      reason: "transcript-unavailable",
    });
    expect(outcome.metrics.transcript).toBeUndefined();
    expect(result.counters.descriptionOnly).toBe(0);
  });

  it("scores a legacy video from its transcript exactly as before", async () => {
    transcriptMock.fetchYoutubeTranscript.mockResolvedValue({
      videoId: "legacy42",
      title: "Large language model agents in production",
      description: "A talk about deploying LLM agents and the tooling around them.",
      channel: "Two Minute Papers",
      durationSeconds: 615,
      text: "A usable transcript sentence about artificial intelligence. ".repeat(4).trim(),
      lang: "en",
      kind: "native",
    });
    const result = await runEvaluationCycle({
      candidates: [rssCandidate()],
      budget: 8,
      deps: { now: NOW, completeJson: verdictReply() as never },
    });

    const outcome = result.outcomes[0];
    expect(outcome.decision).toBe("approved");
    expect(outcome.result?.score).toBeGreaterThanOrEqual(SCORE_GATE);
    expect(outcome.metrics.transcript).toBeUndefined();
    expect(outcome.metrics.youtubeTranscriptKind).toBe("native");
    expect(outcome.result?.originalContent).toContain("Transcript");
    expect(result.counters.descriptionOnly).toBe(0);
  });
});

// ─── Policy primitives ──────────────────────────────────────────────────────

describe("youtube-policy: description-only decisions", () => {
  it("recognises the Data API origin and nothing else", () => {
    expect(isDescriptionOnlyVideo({ origin: "youtube-api" })).toBe(true);
    for (const metrics of [
      null,
      undefined,
      {},
      { origin: "youtube-rss" },
      { origin: "rss" },
      { origin: "youtube" },
      "youtube-api",
      ["youtube-api"],
    ]) {
      expect(isDescriptionOnlyVideo(metrics)).toBe(false);
    }
  });

  it("scores the description as material and keeps the long-form bonus", () => {
    const decision = scoreYoutubeCandidate({
      hasTranscript: false,
      descriptionOnly: true,
      durationSeconds: 615,
      dedicatedChannel: true,
      aiRelevant: true,
    });
    // 45 curated + 15 AI topic + 10 long form; no transcript bonus is paid.
    expect(decision).toEqual({
      eligible: true,
      score: 70,
      reason: "description-only",
      longFormPriority: true,
    });
  });

  it("pays no long-form bonus when the API sent no duration", () => {
    const decision = scoreYoutubeCandidate({
      hasTranscript: false,
      descriptionOnly: true,
      durationSeconds: null,
      dedicatedChannel: true,
      aiRelevant: true,
    });
    expect(decision.score).toBe(60);
    expect(decision.eligible).toBe(true);
    expect(decision.longFormPriority).toBe(false);
  });

  it("keeps the transcript-unavailable refusal for ordinary videos", () => {
    expect(
      scoreYoutubeCandidate({
        hasTranscript: false,
        durationSeconds: 615,
        dedicatedChannel: true,
        aiRelevant: true,
      }),
    ).toEqual({ eligible: false, score: 0, reason: "transcript-unavailable" });
  });
});

// ─── save-summary: the card is written from the description ─────────────────

describe("save-summary: description-only material", () => {
  it("builds the summary text from title + collected description", () => {
    const material = descriptionOnlyMaterial({
      title: "LLM agents that plan and call tools",
      description: LONG_DESCRIPTION,
    });
    expect(material.ok).toBe(true);
    if (!material.ok) return;
    expect(material.text).toContain("LLM agents that plan and call tools");
    expect(material.text).toContain(LONG_DESCRIPTION);
    expect(material.chars).toBe(LONG_DESCRIPTION.length);
  });

  it("refuses a description shorter than 200 characters as insufficient", () => {
    expect(DESCRIPTION_ONLY_MIN_CHARS).toBe(200);
    expect(
      descriptionOnlyMaterial({ title: "Demo", description: SHORT_DESCRIPTION }),
    ).toEqual({
      ok: false,
      reason: "description-too-short",
      chars: SHORT_DESCRIPTION.length,
    });
  });

  it("accepts exactly the 200-character boundary and refuses 199", () => {
    const exact = "x".repeat(200);
    expect(descriptionOnlyMaterial({ title: "t", description: exact }).ok).toBe(true);
    expect(descriptionOnlyMaterial({ title: "t", description: exact.slice(0, 199) }).ok).toBe(
      false,
    );
    // A long title cannot compensate for a missing description.
    expect(
      descriptionOnlyMaterial({ title: "LLM agents ".repeat(40), description: SHORT_DESCRIPTION })
        .ok,
    ).toBe(false);
  });

  it("tells the model the text is short and invention is forbidden", async () => {
    const prompts: string[] = [];
    const completeJson: CompleteJson = async (args) => {
      prompts.push(args.messages[0]?.content ?? "");
      return {
        text: JSON.stringify({
          title_ru: "LLM-агенты планируют шаги",
          summary: "Выжимка по описанию видео.",
        }),
        provider: "gigachat",
        model: "GigaChat",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };

    const draft = await summarizeWithChain(
      {
        title: "LLM agents that plan and call tools",
        content: `LLM agents that plan and call tools\n\n${LONG_DESCRIPTION}`,
        source: "youtube-two-minute-papers",
        mode: "description-only",
      },
      completeJson,
    );
    expect(draft.titleRu).toBe("LLM-агенты планируют шаги");
    expect(prompts[0]).toMatch(/нет полного текста/i);
    expect(prompts[0]).toMatch(/текста мало/i);
    expect(prompts[0]).toMatch(/не додумывай/i);

    // An article summary prompt is unchanged: the note is mode-specific.
    prompts.length = 0;
    await summarizeWithChain({ title: "t", content: "c", source: "nature" }, completeJson);
    expect(prompts[0]).not.toMatch(/нет полного текста/i);
    expect(prompts[0]).toMatch(/title_ru/);
  });
});
