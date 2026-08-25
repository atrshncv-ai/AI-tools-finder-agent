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

  it("rescues an AI×science article whose RSS snippet lacked AI words (RU summary)", () => {
    const sparse = resolveSection({
      title: "Катализатор разлагает пластик за часы",
      description: "Химики испытали соединение на полимерах",
    });
    // At save-summary time the generated Russian summary carries the AI signal.
    const enriched = resolveSection({
      title: "Катализатор разлагает пластик за часы",
      description: "Исследователи обучили нейросеть предсказывать активность соединения; машинное обучение сократило подбор с месяцев до часов.",
    });
    expect(sparse.section).toBe("ai-news");
    expect(enriched.section).toBe("science");
  });

  it("does not let incidental mentions in full text fake invention-tools", () => {
    // YouTube transcripts routinely contain «ДНК», «протеин», «quantum
    // computing» in metaphors or passing mentions (client case: a Google
    // downfall essay retelling AlphaFold history).
    const result = resolveSection({
      title: "The Surprising Downfall of Google",
      description: "Эссе о том, как компания потеряла лидерство в поиске.",
      content: "Рассказ про историю компании: AlphaFold свернул белки, ДНК компании, квантовые вычисления и протеины упоминаются мимоходом.",
    });
    expect(result.section).not.toBe("invention-tools");
    expect(result.sphereTags).toEqual([]);
  });

  it("does not let incidental domain words in full text fake science", () => {
    const result = resolveSection({
      title: "Gemini 3.7 Flash: 50% Cheaper and Faster Than Claude?",
      description: "Новая модель для разработчиков: бенчмарки, цены, Arena.",
      content: "Модель показывает отличные результаты на бенчмарках кода; упоминаются граничные клетки и общие принципы обучения.",
    });
    expect(result.section).toBe("ai-news");
    expect(result.isScience).toBe(false);
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
