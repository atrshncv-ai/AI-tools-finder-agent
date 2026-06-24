import { describe, it, expect, vi, beforeEach } from "vitest";
import { containsAiKeywords, detectLanguage, makeDecisions } from "./parseAgent";
import * as state from "./state";

describe("parseAgent", () => {
  describe("containsAiKeywords", () => {
    it("returns true for AI-related English titles", () => {
      expect(containsAiKeywords("New LLM from OpenAI beats benchmarks")).toBe(true);
      expect(containsAiKeywords("Deep learning advances in 2026")).toBe(true);
    });

    it("returns true for AI-related Russian titles", () => {
      expect(containsAiKeywords("Новая нейросеть от Яндекса")).toBe(true);
      expect(containsAiKeywords("Большая языковая модель показала рекорд")).toBe(true);
    });

    it("returns false for unrelated topics", () => {
      expect(containsAiKeywords("Local football team wins championship")).toBe(false);
      expect(containsAiKeywords("Рецепт борща: классический вариант")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(containsAiKeywords("ARTIFICIAL INTELLIGENCE REGULATION")).toBe(true);
      expect(containsAiKeywords("НЕЙРОСЕТЬ")).toBe(true);
    });
  });

  describe("detectLanguage", () => {
    it("detects Russian", () => {
      expect(detectLanguage("Новая нейросеть от российских ученых")).toBe("ru");
    });

    it("detects English", () => {
      expect(detectLanguage("Scientists develop new artificial intelligence model for medical diagnosis")).toBe("en");
    });

    it("detects German", () => {
      expect(detectLanguage("Künstliche Intelligenz revolutioniert die Medizin")).toBe("de");
    });

    it("returns unknown for short or empty text", () => {
      expect(detectLanguage("")).toBe("unknown");
      expect(detectLanguage("Hi")).toBe("unknown");
    });
  });

  describe("makeDecisions", () => {
    beforeEach(() => {
      vi.spyOn(state, "shouldSkipSource").mockReturnValue(false);
      vi.spyOn(state, "getSourcePriority").mockReturnValue("medium");
      vi.spyOn(state, "getSourceHealth").mockReturnValue({
        sourceId: 1,
        sourceName: "Test",
        status: "healthy",
        lastCheck: null,
        lastSuccess: null,
        lastError: null,
        consecutiveFails: 0,
        successRate: 1,
        avgResponseTime: 0,
        selectorWorks: true,
        runCount: 0,
        successCount: 0,
      });
    });

    it("skips disabled sources", () => {
      const sources = [
        { id: 1, name: "Enabled", enabled: true },
        { id: 2, name: "Disabled", enabled: false },
      ];
      const decisions = makeDecisions(sources);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].sourceName).toBe("Enabled");
    });

    it("limits articles for low priority sources", () => {
      vi.spyOn(state, "getSourcePriority").mockReturnValue("low");
      const sources = [{ id: 1, name: "Low", enabled: true }];
      const decisions = makeDecisions(sources);
      expect(decisions[0].maxArticles).toBe(10);
    });

    it("reduces limit for sources with failures", () => {
      vi.spyOn(state, "getSourceHealth").mockReturnValue({
        sourceId: 1,
        sourceName: "Failing",
        status: "degraded",
        lastCheck: null,
        lastSuccess: null,
        lastError: "timeout",
        consecutiveFails: 3,
        successRate: 0.5,
        avgResponseTime: 1000,
        selectorWorks: true,
        runCount: 5,
        successCount: 2,
      });
      const sources = [{ id: 1, name: "Failing", enabled: true }];
      const decisions = makeDecisions(sources);
      expect(decisions[0].maxArticles).toBe(20);
    });
  });
});
