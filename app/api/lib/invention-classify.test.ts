import { describe, expect, it } from "vitest";
import { classifyInvention } from "./invention-classify";

describe("classifyInvention", () => {
  it("routes material discovery to inventions and keeps multiple sphere tags", () => {
    const result = classifyInvention("ИИ открыл новый материал и предложил химический синтез");
    expect(result.section).toBe("invention-tools");
    expect(result.sphereTags).toEqual(expect.arrayContaining(["материалы", "химия"]));
  });

  it("keeps a genuine AI-for-science tool in inventions (AlphaFold, ru)", () => {
    const result = classifyInvention(
      "AlphaFold предсказал структуру нового белка для разработки лекарства. Модель машинного обучения использована для дизайна молекулы препарата."
    );
    expect(result.isInvention).toBe(true);
  });

  it("keeps CRISPR + machine learning research in inventions", () => {
    const result = classifyInvention(
      "CRISPR screening with machine learning discovered new gene targets"
    );
    expect(result.isInvention).toBe(true);
  });

  it("leaves ordinary AI news in the generic section", () => {
    expect(classifyInvention("Новый интерфейс чат-бота").section).toBe("ai-news");
  });

  // ── Client feedback of 2026-08-25: household medical/science news must
  // never route to invention-tools, even with clinical vocabulary present.

  it("rejects pure medical news without an AI signal (mitochondria eye injection)", () => {
    const result = classifyInvention(
      "Впервые проведена инъекция собственных митохондрий в глаза для лечения слепоты. " +
        "Медики впервые пересадили митохондрии пациентам с глазным заболеванием. Клиническое исследование показало улучшение."
    );
    expect(result.isInvention).toBe(false);
  });

  it("rejects supercentenarian blood study without an AI signal", () => {
    const result = classifyInvention(
      "У долгожителей старше 110 лет больше редких противоопухолевых клеток. Изучение крови супердолгожителей выявило особенности иммунных клеток."
    );
    expect(result.isInvention).toBe(false);
  });

  it("rejects generic consumer AI tools without a discovery topic", () => {
    const result = classifyInvention(
      "Google обновил поиск: ИИ-режим и планирование мероприятий. Новые инструменты Google Search помогают организовать ужин и досуг с помощью искусственного интеллекта."
    );
    expect(result.isInvention).toBe(false);
  });
});
