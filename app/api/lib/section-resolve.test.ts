import { describe, expect, it } from "vitest";
import { resolveSection } from "./section-resolve";

describe("resolveSection", () => {
  it("prioritizes invention-tools over science for AI tool discoveries", () => {
    const result = resolveSection({
      title: "AlphaFold предсказал структуру нового белка",
      description: "Модель машинного обучения для биологии и разработки лекарств",
    });
    expect(result.section).toBe("invention-tools");
    expect(result.isScience).toBe(true);
    expect(result.sphereTags.length).toBeGreaterThan(0);
  });

  it("routes AI × science news to the science section", () => {
    const result = resolveSection({
      title: "Нейросеть научилась читать спектры крови для ранней диагностики рака",
      description: "Модель машинного обучения находит онкологические маркеры в анализах пациентов",
    });
    expect(result.section).toBe("science");
    expect(result.isScience).toBe(true);
  });

  it("routes generic AI product news to ai-news", () => {
    const result = resolveSection({
      title: "OpenAI обновила интерфейс чат-бота",
      description: "Новая версия модели доступна подписчикам",
    });
    expect(result.section).toBe("ai-news");
    expect(result.isScience).toBe(false);
  });

  // ── Client feedback of 2026-08-25 ──

  it("keeps pure medical news out of science and inventions", () => {
    const result = resolveSection({
      title: "Впервые проведена инъекция собственных митохондрий в глаза для лечения слепоты",
      description: "Клиническое исследование показало улучшение зрения у пациентов",
    });
    expect(result.section).toBe("ai-news");
    expect(result.isScience).toBe(false);
  });

  it("rescues an AI×science article whose RSS snippet lacked AI words (full text)", () => {
    const sparse = resolveSection({
      title: "Катализатор разлагает пластик за часы",
      description: "Химики испытали соединение на полимерах",
    });
    const enriched = resolveSection({
      title: "Катализатор разлагает пластик за часы",
      description: "Химики испытали соединение на полимерах",
      content: "Исследователи обучили нейросеть предсказывать активность соединения; машинное обучение сократило подбор с месяцев до часов.",
    });
    expect(sparse.section).toBe("ai-news");
    expect(enriched.section).toBe("science");
  });

  it("moves a misfiled invention-tools article back out when text has no AI signal", () => {
    const result = resolveSection({
      title: "У долгожителей старше 110 лет больше редких противоопухолевых клеток",
      description: "Изучение крови супердолгожителей выявило особенности иммунных клеток",
    });
    expect(result.section).toBe("ai-news");
    expect(result.sphereTags).toEqual([]);
  });
});
