/**
 * save-summary.test.ts — the summary prompt contract.
 *
 * Why: the dashboard card shows the whole summary, so the model must write a
 * dense text of 400–500 characters instead of 3–5 vague sentences. Telegram
 * still clips its copy to 180 characters (`digest-format.fitSummary`), which is
 * a separate agreed limit and is not touched by this prompt.
 */
import { describe, expect, it } from "vitest";
import { summarizeWithChain } from "./save-summary";
import type { ChatResult, CompleteJson } from "../../api/ai/providers/types";

const SUMMARY_JSON = JSON.stringify({
  title_ru: "Новая ИИ-модель предсказывает структуру белков",
  summary: "Модель предсказывает укладку белков точнее прежних методов.",
});

/** The system prompt the chain actually receives for one summary request. */
async function systemPrompt(mode?: "article" | "description-only"): Promise<string> {
  let prompt = "";
  const completeJson: CompleteJson = async (args) => {
    prompt = args.messages[0]?.content ?? "";
    const result: ChatResult = {
      text: SUMMARY_JSON,
      provider: "gigachat",
      model: "GigaChat",
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    return result;
  };
  await summarizeWithChain(
    {
      title: "A model predicts protein structures",
      content: "The network predicts folding of a protein complex in cells.",
      source: "nature",
      ...(mode ? { mode } : {}),
    },
    completeJson,
  );
  return prompt;
}

describe("summary prompt: 400–500 characters in 2–3 dense sentences", () => {
  it("asks for a 400–500 character summary", async () => {
    const prompt = await systemPrompt();
    expect(prompt).toContain("400–500");
    expect(prompt).toMatch(/400–500 знаков/);
  });

  it("asks for 2–3 dense sentences: what happened, how it works, why it matters", async () => {
    const prompt = await systemPrompt();
    expect(prompt).toMatch(/2–3 плотных предложения/);
    expect(prompt).toContain("что произошло");
    expect(prompt).toContain("как это работает");
    expect(prompt).toContain("почему это важно");
  });

  it("forbids filler, introductory phrases and «в статье рассказывается»", async () => {
    const prompt = await systemPrompt();
    expect(prompt).toMatch(/без воды/i);
    expect(prompt).toMatch(/вводных фраз/);
    expect(prompt).toContain("«в статье рассказывается»");
  });

  it("forbids inventing when the material is shorter than the target", async () => {
    const prompt = await systemPrompt();
    expect(prompt).toMatch(/материала меньше/i);
    expect(prompt).toMatch(/не выдумывай/i);
    expect(prompt).toMatch(/по факту/i);
  });

  it("keeps the short-material rule for a description-only video", async () => {
    const prompt = await systemPrompt("description-only");
    expect(prompt).toContain("400–500");
    expect(prompt).toMatch(/текста мало/i);
    expect(prompt).toMatch(/не додумывай/i);
  });
});
