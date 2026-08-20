import { describe, expect, it } from "vitest";
import { hasExplicitAiSignal } from "../../api/lib/classify";

describe("evaluate-news hard AI gate", () => {
  it("rejects a high-tier non-AI story (polycrisis youth networks, Nature)", () => {
    const text =
      "Сети поддержки помогают молодежи справляться с поликризисом. Организации Force of Nature и Good Grief Network создают группы взаимопомощи для подростков, сталкивающихся с тревогой из-за глобальных проблем. Исследования фиксируют высокий уровень эко-тревожности: в опросе 10 тыс. молодых людей из 10 стран 56% согласились с тезисом о гибели человечества. Программы предлагают онлайн-сессии, валидацию чувств и составление плана действий.";
    expect(hasExplicitAiSignal(text)).toBe(false);
  });

  it("rejects orcas / Fields medal / exoplanet junk (past false positives)", () => {
    expect(hasExplicitAiSignal("Косатки научились ловить рыбу в открытом море")).toBe(false);
    expect(hasExplicitAiSignal("Астрономы обнаружили экзоспутник у далёкой планеты")).toBe(false);
    expect(hasExplicitAiSignal("Математик получил медаль Филдса за работу в топологии")).toBe(false);
  });

  it("accepts explicit AI/ML stories", () => {
    expect(
      hasExplicitAiSignal(
        "ИИ-инструмент TRI прогнозирует патентный потенциал исследований с помощью машинного обучения",
      ),
    ).toBe(true);
    expect(
      hasExplicitAiSignal("OpenAI выпустила новую языковую модель GPT для анализа белков"),
    ).toBe(true);
  });

  it("the gate composes with the score gate (no AI signal → never approved)", () => {
    const score = 70; // tier1 + invention bonus — high enough without AI
    const hasAiSignal = hasExplicitAiSignal("Учёные изучают поведение дельфинов в Тихом океане");
    const passesGate = score >= 50 && hasAiSignal;
    expect(passesGate).toBe(false);
  });
});
