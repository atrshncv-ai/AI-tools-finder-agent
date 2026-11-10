import { describe, expect, it } from "vitest";
import { DIRECTIONS, TOPIC_PROMPT_RU } from "./topics";
import {
  INVALID_JUDGEMENT_REASON,
  INVALID_REVIEW_REASON,
  JUDGE_CONFIDENCE_THRESHOLD,
  REJECTED_BY_REVIEW_REASON,
  judgeRelevance,
} from "./judge";
import type { ChatMessage, CompleteJson } from "../../api/ai/providers/types";

const BIOLOGY_ARTICLE = {
  title: "AlphaFold-like model rebuilt the ribosome protein structure",
  lead: "The neural network predicted the folding of a large protein complex in cells.",
};

const PROVIDER_META = {
  provider: "gigachat" as const,
  model: "GigaChat-2",
  usage: { inputTokens: 120, outputTokens: 24 },
};

/**
 * The judge makes two calls for an on-topic candidate: the verdict and an
 * independent review of that verdict. The stub answers them in order and
 * throws on any extra call, so a forgotten or doubled call is visible.
 */
function stub(replies: string[]): { completeJson: CompleteJson; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  const completeJson: CompleteJson = async (args) => {
    const reply = replies[calls.length];
    if (reply === undefined) throw new Error("judge made an unexpected extra call");
    calls.push(args.messages);
    return { text: reply, ...PROVIDER_META };
  };
  return { completeJson, calls };
}

const VALID_BIOLOGY_REPLY = JSON.stringify({
  onTopic: true,
  section: "science",
  direction: "biology",
  confidence: 0.92,
  reason: "Нейросеть предсказала структуру белка",
});

const REVIEW_OK = JSON.stringify({ agree: true, confidence: 0.9, reason: "подтверждаю вердикт" });

describe("judgeRelevance — valid verdict with an independent review", () => {
  it("returns the parsed judgement when the reviewer confirms", async () => {
    const { completeJson, calls } = stub([VALID_BIOLOGY_REPLY, REVIEW_OK]);
    await expect(judgeRelevance(BIOLOGY_ARTICLE, { completeJson })).resolves.toEqual({
      onTopic: true,
      section: "science",
      direction: "biology",
      confidence: 0.92,
      reason: "Нейросеть предсказала структуру белка",
    });
    expect(calls).toHaveLength(2);
  });

  it("sends the topics rubric, wraps the article and asks for an independent check", async () => {
    const { completeJson, calls } = stub([VALID_BIOLOGY_REPLY, REVIEW_OK]);
    await judgeRelevance({ ...BIOLOGY_ARTICLE, language: "en" }, { completeJson });

    const [verdictMessages, reviewMessages] = calls;

    expect(verdictMessages[0].role).toBe("system");
    expect(verdictMessages[0].content).toBe(TOPIC_PROMPT_RU);
    expect(verdictMessages[1].role).toBe("user");
    expect(verdictMessages[1].content).toContain("Язык материала: en");
    expect(verdictMessages[1].content).toContain("--- BEGIN ARTICLE (UNTRUSTED) ---");
    expect(verdictMessages[1].content).toContain("--- END ARTICLE ---");
    expect(verdictMessages[1].content).toContain(BIOLOGY_ARTICLE.title);
    expect(verdictMessages[1].content).toContain(BIOLOGY_ARTICLE.lead);

    // The review is a different question about the *claimed* verdict, not a
    // paraphrase of the first one: it names the section, the direction and the
    // claim, and repeats the article inside the untrusted markers.
    expect(reviewMessages[0].role).toBe("system");
    expect(reviewMessages[0].content).toContain("проверяющий");
    expect(reviewMessages[0].content).toContain('"agree"');
    expect(reviewMessages[1].role).toBe("user");
    expect(reviewMessages[1].content).toContain("ИИ для науки");
    expect(reviewMessages[1].content).toContain("Биология");
    expect(reviewMessages[1].content).toContain("Нейросеть предсказала структуру белка");
    expect(reviewMessages[1].content).toContain("--- BEGIN ARTICLE (UNTRUSTED) ---");
    expect(reviewMessages[1].content).toContain(BIOLOGY_ARTICLE.title);
  });

  it("accepts JSON wrapped in a markdown fence or in prose", async () => {
    const fenced = stub(["```json\n" + VALID_BIOLOGY_REPLY + "\n```", REVIEW_OK]);
    await expect(
      judgeRelevance(BIOLOGY_ARTICLE, { completeJson: fenced.completeJson }).then((j) => j.section),
    ).resolves.toBe("science");

    const prose = stub([`Вердикт: ${VALID_BIOLOGY_REPLY} — так и запиши.`, REVIEW_OK]);
    await expect(
      judgeRelevance(BIOLOGY_ARTICLE, { completeJson: prose.completeJson }).then((j) => j.onTopic),
    ).resolves.toBe(true);
  });

  it("allows a science direction on an invention-tools card", async () => {
    const { completeJson } = stub([
      JSON.stringify({
        onTopic: true,
        section: "invention-tools",
        direction: "chemistry",
        confidence: 0.85,
        reason: "библиотека для генерации молекул",
      }),
      REVIEW_OK,
    ]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.section).toBe("invention-tools");
    expect(judgement.direction).toBe("chemistry");
  });
});

describe("judgeRelevance — confidence gate (fail-closed)", () => {
  it("rejects below the threshold without spending the review call", async () => {
    const { completeJson, calls } = stub([
      JSON.stringify({ onTopic: true, section: "science", direction: "biology", confidence: 0.69, reason: "похоже" }),
    ]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(JUDGE_CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(judgement).toEqual({
      onTopic: false,
      section: "ai-news",
      direction: null,
      confidence: 0.69,
      reason: "low-confidence",
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps the verdict at exactly the threshold and reviews it", async () => {
    const { completeJson, calls } = stub([
      JSON.stringify({ onTopic: true, section: "science", direction: "physics", confidence: 0.7, reason: "на пороге" }),
      REVIEW_OK,
    ]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.onTopic).toBe(true);
    expect(judgement.direction).toBe("physics");
    expect(calls).toHaveLength(2);
  });

  it("does not resurrect a rejected verdict that happens to be confident", async () => {
    const { completeJson, calls } = stub([
      JSON.stringify({
        onTopic: false,
        section: "science",
        direction: "biology",
        confidence: 0.95,
        reason: "это не про биологию",
      }),
    ]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.onTopic).toBe(false);
    expect(judgement.section).toBe("ai-news");
    expect(judgement.direction).toBeNull();
    expect(judgement.reason).toBe("это не про биологию");
    expect(calls).toHaveLength(1);
  });
});

describe("judgeRelevance — independent review catches a plausible wrong answer", () => {
  const WRONG_BIOLOGY = JSON.stringify({
    onTopic: true,
    section: "science",
    direction: "biology",
    confidence: 0.9,
    reason: "материал про энергосети и ИИ",
  });

  it("rejects the verdict when the reviewer disagrees", async () => {
    const { completeJson, calls } = stub([
      WRONG_BIOLOGY,
      JSON.stringify({ agree: false, confidence: 0.9, reason: "это энергосети, а не биология" }),
    ]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(calls).toHaveLength(2);
    expect(judgement).toEqual({
      onTopic: false,
      section: "ai-news",
      direction: null,
      confidence: 0.9,
      reason: REJECTED_BY_REVIEW_REASON,
    });
  });

  it("rejects the verdict when the reviewer is not confident enough", async () => {
    const { completeJson } = stub([
      WRONG_BIOLOGY,
      JSON.stringify({ agree: true, confidence: 0.55, reason: "вроде биология" }),
    ]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.onTopic).toBe(false);
    expect(judgement.reason).toBe(REJECTED_BY_REVIEW_REASON);
  });

  it("rejects the verdict when the reviewer answer is malformed", async () => {
    const { completeJson } = stub([WRONG_BIOLOGY, "Не могу проверить."]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.onTopic).toBe(false);
    expect(judgement.reason).toBe(INVALID_REVIEW_REASON);
  });

  it("rejects the verdict when the review call fails", async () => {
    let calls = 0;
    const completeJson: CompleteJson = async () => {
      calls += 1;
      if (calls === 1) return { text: WRONG_BIOLOGY, ...PROVIDER_META };
      throw new Error("provider exploded");
    };
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.onTopic).toBe(false);
    expect(judgement.reason).toBe(INVALID_REVIEW_REASON);
  });
});

describe("judgeRelevance — invalid answers never throw", () => {
  const invalidReplies: Array<[string, string]> = [
    ["truncated JSON", '{"onTopic": true, "section": "science", "direction": "biology",'],
    ["plain text", "Модель не смогла ответить."],
    ["empty string", ""],
    ["JSON array", JSON.stringify([{ onTopic: true, section: "science", direction: "biology", confidence: 0.9 }])],
    [
      "JSON array wrapped in prose",
      'Ответ модели: [{"onTopic": true, "section": "science", "direction": "biology", "confidence": 0.9}] — всё.',
    ],
    ["null", "null"],
    [
      "unknown section",
      JSON.stringify({ onTopic: true, section: "robotics", direction: null, confidence: 0.9, reason: "x" }),
    ],
    [
      "unknown direction",
      JSON.stringify({ onTopic: true, section: "science", direction: "astrology", confidence: 0.9, reason: "x" }),
    ],
    [
      "science without direction",
      JSON.stringify({ onTopic: true, section: "science", direction: null, confidence: 0.9, reason: "x" }),
    ],
    [
      "ai-news with a science direction",
      JSON.stringify({ onTopic: true, section: "ai-news", direction: "physics", confidence: 0.9, reason: "x" }),
    ],
    [
      "confidence as string",
      JSON.stringify({ onTopic: true, section: "science", direction: "biology", confidence: "0.9", reason: "x" }),
    ],
    [
      "confidence above 1",
      JSON.stringify({ onTopic: true, section: "science", direction: "biology", confidence: 1.4, reason: "x" }),
    ],
    [
      "onTopic as string",
      JSON.stringify({ onTopic: "yes", section: "science", direction: "biology", confidence: 0.9, reason: "x" }),
    ],
    [
      "empty reason",
      JSON.stringify({ onTopic: true, section: "science", direction: "biology", confidence: 0.9, reason: "  " }),
    ],
  ];

  it.each(invalidReplies)("returns a fail-closed verdict for %s", async (_label, reply) => {
    const { completeJson, calls } = stub([reply]);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement).toEqual({
      onTopic: false,
      section: "ai-news",
      direction: null,
      confidence: 0,
      reason: INVALID_JUDGEMENT_REASON,
    });
    expect(calls).toHaveLength(1);
  });

  it("fails closed when the model call throws", async () => {
    const completeJson: CompleteJson = async () => {
      throw new Error("provider exploded");
    };
    await expect(judgeRelevance(BIOLOGY_ARTICLE, { completeJson }).then((j) => j.onTopic)).resolves.toBe(false);
  });

  it("fails closed when no completeJson dependency is injected", async () => {
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE);
    expect(judgement.onTopic).toBe(false);
    expect(judgement.reason).toBe(INVALID_JUDGEMENT_REASON);
  });
});

describe("judgeRelevance — topics registry drives the prompt", () => {
  it("keeps the energy-grids guard in the rubric (the miss the owner named)", () => {
    expect(TOPIC_PROMPT_RU).toContain("энергосет");
    expect(TOPIC_PROMPT_RU).toMatch(/НЕ «Биология» и НЕ «Физика»/);
  });

  it("names every registered direction in the rubric", () => {
    for (const direction of DIRECTIONS) {
      expect(TOPIC_PROMPT_RU).toContain(direction.id);
      expect(TOPIC_PROMPT_RU).toContain(direction.label);
    }
  });

  it("accepts any registered direction without per-direction code", async () => {
    for (const direction of DIRECTIONS) {
      const { completeJson } = stub([
        JSON.stringify({
          onTopic: true,
          section: "science",
          direction: direction.id,
          confidence: 0.9,
          reason: `направление ${direction.label}`,
        }),
        REVIEW_OK,
      ]);
      const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });
      expect(judgement.direction).toBe(direction.id);
    }
  });
});
