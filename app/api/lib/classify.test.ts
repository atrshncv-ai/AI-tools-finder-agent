import { describe, it, expect } from "vitest";
import { classifyArticle } from "./classify";

describe("classifyArticle", () => {
  describe("science field detection", () => {
    it("detects chemistry", () => {
      const result = classifyArticle(
        "Новый катализатор для органического синтеза",
        "Исследователи разработали полимерный катализатор"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("chemistry");
    });

    it("detects materials science", () => {
      const result = classifyArticle(
        "Наноматериал для полупроводников",
        "Новый композит с высокой проводимостью"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("materials");
    });

    it("detects biology", () => {
      const result = classifyArticle(
        "ИИ для анализа ДНК",
        "Биоинформатика и геномика"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("biology");
    });

    it("detects medicine", () => {
      const result = classifyArticle(
        "ИИ в диагностике заболеваний",
        "Новая вакцина для клинических испытаний"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("medicine");
    });

    it("detects physics", () => {
      const result = classifyArticle(
        "Квантовые вычисления для физики частиц",
        "Суперпроводник нового типа"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("physics");
    });

    it("detects engineering", () => {
      const result = classifyArticle(
        "Новый GPU для вычислений",
        "Робот-инженер для серверов"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("engineering");
    });
  });

  describe("science tool detection", () => {
    it("detects science tool with instrument keyword", () => {
      const result = classifyArticle(
        "ИИ-инструмент для химии",
        "Новая платформа для синтеза молекул"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("chemistry");
    });

    it("detects science tool with model keyword", () => {
      const result = classifyArticle(
        "Модель для анализа белков",
        "Биологическая модель для геномики"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("biology");
    });

    it("detects science tool with update keyword", () => {
      const result = classifyArticle(
        "Обновление инструмента для физики",
        "Новая версия платформы для квантовых вычислений"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("physics");
    });
  });

  describe("category detection", () => {
    it("detects new-llm category", () => {
      const result = classifyArticle(
        "Анонс новой LLM от Cohere",
        "Модель command r для enterprise"
      );
      expect(result.categorySlug).toBe("new-llm");
    });

    it("detects ai-agent category", () => {
      const result = classifyArticle(
        "Автономный ИИ-агент",
        "Многошаговая оркестрация задач"
      );
      expect(result.categorySlug).toBe("ai-agent");
    });

    it("detects comparison category", () => {
      const result = classifyArticle(
        "Кто лучше в генерации текста",
        "Сравнение двух моделей versus подходов"
      );
      expect(result.categorySlug).toBe("comparison");
    });

    it("detects benchmarks category", () => {
      const result = classifyArticle(
        "Результаты HumanEval и MMLU",
        "Оценка точности на стандартных тестах"
      );
      expect(result.categorySlug).toBe("benchmarks");
    });

    it("detects updates category", () => {
      const result = classifyArticle(
        "Обновление фреймворка v3",
        "Улучшения в новой версии"
      );
      expect(result.categorySlug).toBe("updates");
    });
  });

  describe("non-science articles", () => {
    it("returns isScience false for unrelated content", () => {
      const result = classifyArticle(
        "Рецепт борща",
        "Как сварить вкусный борщ"
      );
      expect(result.isScience).toBe(false);
      expect(result.scienceField).toBeNull();
    });

    it("detects AI category without science field", () => {
      const result = classifyArticle(
        "Новый autonomous agent для данных",
        "Многошаговый reasoning pipeline"
      );
      expect(result.isScience).toBe(false);
      expect(result.categorySlug).toBe("ai-agent");
    });
  });

  describe("edge cases", () => {
    it("handles empty strings", () => {
      const result = classifyArticle("", "");
      expect(result.isScience).toBe(false);
      expect(result.scienceField).toBeNull();
      expect(result.categorySlug).toBeNull();
    });

    it("handles case insensitivity", () => {
      const result = classifyArticle(
        "CHEMISTRY and MOLECULE synthesis",
        "ORGANIC compound"
      );
      expect(result.isScience).toBe(true);
      expect(result.scienceField).toBe("chemistry");
    });

    it("handles mixed Russian and English", () => {
      const result = classifyArticle(
        "Новая LLM модель от OpenAI",
        "GPT-5 с улучшенным контекстом"
      );
      expect(result.categorySlug).toBe("new-llm");
    });
  });

  describe("classification type detection", () => {
    it("detects new_tool type", () => {
      const result = classifyArticle(
        "Новый инструмент для химии",
        "Платформа для синтеза молекул"
      );
      expect(result.isScience).toBe(true);
      expect(result.classificationType).toBe("new_tool");
    });

    it("detects update type", () => {
      const result = classifyArticle(
        "Обновление инструмента для физики",
        "Новая версия платформы"
      );
      expect(result.isScience).toBe(true);
      expect(result.classificationType).toBe("update");
    });

    it("detects closure type", () => {
      const result = classifyArticle(
        "Закрытие сервиса для биологии",
        "Deprecated API для геномики"
      );
      expect(result.isScience).toBe(true);
      expect(result.classificationType).toBe("closure");
    });

    it("detects achievement type", () => {
      const result = classifyArticle(
        "Достижение в медицине: прорыв в лечении рака",
        "Учёные добились рекордных результатов в диагnostic"
      );
      expect(result.isScience).toBe(true);
      expect(result.classificationType).toBe("achievement");
    });

    it("returns null classificationType for non-science", () => {
      const result = classifyArticle(
        "Обновление GPT-5",
        "Новая версия модели"
      );
      expect(result.isScience).toBe(false);
      expect(result.classificationType).toBeNull();
    });
  });
});
