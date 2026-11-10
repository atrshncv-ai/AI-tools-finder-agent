import { describe, expect, it } from "vitest";
import { DIRECTIONS, TOPIC_PROMPT_RU } from "./topics";
import {
  INVALID_JUDGEMENT_REASON,
  JUDGE_CONFIDENCE_THRESHOLD,
  judgeRelevance,
  type CompleteJson,
} from "./judge";

const BIOLOGY_ARTICLE = {
  title: "AlphaFold-like model rebuilt the ribosome protein structure",
  lead: "The neural network predicted the folding of a large protein complex in cells.",
};

function stub(reply: string): { completeJson: CompleteJson; calls: Array<Array<{ role: string; content: string }>> } {
  const calls: Array<Array<{ role: string; content: string }>> = [];
  const completeJson: CompleteJson = async (args) => {
    calls.push(args.messages);
    return { text: reply };
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

describe("judgeRelevance — valid verdict", () => {
  it("returns the parsed judgement for a strict JSON answer", async () => {
    const { completeJson } = stub(VALID_BIOLOGY_REPLY);
    await expect(judgeRelevance(BIOLOGY_ARTICLE, { completeJson })).resolves.toEqual({
      onTopic: true,
      section: "science",
      direction: "biology",
      confidence: 0.92,
      reason: "Нейросеть предсказала структуру белка",
    });
  });

  it("allows a science direction on an invention-tools card", async () => {
    const { completeJson } = stub(
      JSON.stringify({
        onTopic: true,
        section: "invention-tools",
        direction: "chemistry",
        confidence: 0.85,
        reason: "библиотека для генерации молекул",
      }),
    );
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.section).toBe("invention-tools");
    expect(judgement.direction).toBe("chemistry");
  });

  it("sends the topics rubric and wraps the article as untrusted data", async () => {
    const { completeJson, calls } = stub(VALID_BIOLOGY_REPLY);
    await judgeRelevance({ ...BIOLOGY_ARTICLE, language: "en" }, { completeJson });

    expect(calls).toHaveLength(1);
    const messages = calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(TOPIC_PROMPT_RU);

    const userText = messages[1].content;
    expect(messages[1].role).toBe("user");
    expect(userText).toContain("Язык материала: en");
    expect(userText).toContain("--- BEGIN ARTICLE (UNTRUSTED) ---");
    expect(userText).toContain("--- END ARTICLE ---");
    expect(userText).toContain(BIOLOGY_ARTICLE.title);
    expect(userText).toContain(BIOLOGY_ARTICLE.lead);
  });

  it("accepts JSON wrapped in a markdown fence or in prose", async () => {
    const fenced = stub("```json\n" + VALID_BIOLOGY_REPLY + "\n```");
    await expect(judgeRelevance(BIOLOGY_ARTICLE, { completeJson: fenced.completeJson }).then((j) => j.section)).resolves.toBe(
      "science",
    );

    const prose = stub(`Вердикт: ${VALID_BIOLOGY_REPLY} — так и запиши.`);
    await expect(judgeRelevance(BIOLOGY_ARTICLE, { completeJson: prose.completeJson }).then((j) => j.onTopic)).resolves.toBe(
      true,
    );
  });
});

describe("judgeRelevance — confidence gate (fail-closed)", () => {
  it("rejects a confident-looking answer below the 0.7 threshold", async () => {
    const { completeJson } = stub(
      JSON.stringify({ onTopic: true, section: "science", direction: "biology", confidence: 0.69, reason: "похоже" }),
    );
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(JUDGE_CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(judgement.onTopic).toBe(false);
    expect(judgement.reason).toBe("low-confidence");
    expect(judgement.confidence).toBe(0.69);
  });

  it("keeps the verdict at exactly the threshold", async () => {
    const { completeJson } = stub(
      JSON.stringify({ onTopic: true, section: "science", direction: "physics", confidence: 0.7, reason: "на пороге" }),
    );
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.onTopic).toBe(true);
    expect(judgement.direction).toBe("physics");
  });

  it("does not resurrect a rejected verdict that happens to be confident", async () => {
    const { completeJson } = stub(
      JSON.stringify({
        onTopic: false,
        section: "science",
        direction: "biology",
        confidence: 0.95,
        reason: "это не про биологию",
      }),
    );
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement.onTopic).toBe(false);
    expect(judgement.reason).toBe("это не про биологию");
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
    const { completeJson } = stub(reply);
    const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });

    expect(judgement).toEqual({
      onTopic: false,
      section: "ai-news",
      direction: null,
      confidence: 0,
      reason: INVALID_JUDGEMENT_REASON,
    });
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
      const { completeJson } = stub(
        JSON.stringify({
          onTopic: true,
          section: "science",
          direction: direction.id,
          confidence: 0.9,
          reason: `направление ${direction.label}`,
        }),
      );
      const judgement = await judgeRelevance(BIOLOGY_ARTICLE, { completeJson });
      expect(judgement.direction).toBe(direction.id);
    }
  });
});
