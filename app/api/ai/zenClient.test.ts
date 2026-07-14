import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockZenSuccess(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "chatcmpl-test",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
  });
}

function mockZenError(status: number, body = "error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  });
}

// ─── Reset between tests ────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: import zenClient with env overrides
async function importZen(envOverrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    ZEN_BASE_URL: "https://api.test-zen.ai/v1",
    ZEN_API_KEY: "test-key",
    ZEN_MODEL: "test-model",
    ZEN_RETRIES: "2",
    ZEN_RETRY_DELAY_MS: "5",
    ZEN_TIMEOUT_MS: "5000",
    ZEN_CONCURRENCY: "1",
    ZEN_CIRCUIT_BREAKER_THRESHOLD: "3",
    ZEN_CIRCUIT_BREAKER_RESET_MS: "50",
  };
  Object.entries({ ...defaults, ...envOverrides }).forEach(([k, v]) => {
    process.env[k] = v;
  });
  return import("./zenClient");
}

// ─── Token utilities ────────────────────────────────────────────────────────

describe("countTokens", () => {
  it("counts tokens in a simple string", async () => {
    const { countTokens } = await importZen();
    const count = countTokens("hello world");
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
  });

  it("returns approximate count on error", async () => {
    const { countTokens } = await importZen();
    const count = countTokens("");
    expect(count).toBe(0);
  });

  it("scales with text length", async () => {
    const { countTokens } = await importZen();
    const short = countTokens("hello");
    const long = countTokens("hello world this is a much longer sentence with many tokens");
    expect(long).toBeGreaterThan(short);
  });
});

describe("truncateToTokens", () => {
  it("returns original text if within limit", async () => {
    const { truncateToTokens } = await importZen();
    const text = "short text";
    const result = truncateToTokens(text, 1000);
    expect(result).toBe(text);
  });

  it("truncates text exceeding token limit", async () => {
    const { truncateToTokens, countTokens } = await importZen();
    const text = "word ".repeat(500);
    const result = truncateToTokens(text, 10);
    const truncatedTokens = countTokens(result);
    expect(truncatedTokens).toBeLessThanOrEqual(15);
  });

  it("returns empty string for zero or negative limit", async () => {
    const { truncateToTokens } = await importZen();
    expect(truncateToTokens("hello", 0)).toBe("");
    expect(truncateToTokens("hello", -5)).toBe("");
  });
});

// ─── Circuit Breaker ────────────────────────────────────────────────────────

describe("circuit breaker", () => {
  it("starts in closed state", async () => {
    const { getCircuitState } = await importZen();
    const state = getCircuitState();
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
  });

  it("reset restores closed state", async () => {
    const { getCircuitState, resetCircuitBreaker } = await importZen();
    resetCircuitBreaker();
    const state = getCircuitState();
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
    expect(state.successCount).toBe(0);
  });
});

// ─── chatCompletion ─────────────────────────────────────────────────────────

describe("chatCompletion", () => {
  it("returns result on first successful attempt", async () => {
    mockZenSuccess("Тестовый ответ");
    const { chatCompletion } = await importZen();

    const result = await chatCompletion([{ role: "user", content: "test" }]);

    expect(result).toBe("Тестовый ответ");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    mockZenError(500, "Internal error");
    mockZenSuccess("Retry success");
    const { chatCompletion } = await importZen();

    const result = await chatCompletion([{ role: "user", content: "test" }]);

    expect(result).toBe("Retry success");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 10000);

  it("throws after exhausting all retries", async () => {
    mockZenError(500, "error 1");
    mockZenError(500, "error 2");
    mockZenError(500, "error 3");
    const { chatCompletion } = await importZen();

    await expect(
      chatCompletion([{ role: "user", content: "test" }]),
    ).rejects.toThrow("chatCompletion failed after 3 attempts");
  }, 10000);

  it("cleans AI output artifacts", async () => {
    mockZenSuccess("**Научный редактор**\n\nЭто саммари статьи о квантовых вычислениях.");
    const { chatCompletion } = await importZen();

    const result = await chatCompletion([{ role: "user", content: "test" }]);

    expect(result).not.toContain("Научный редактор");
    expect(result).toContain("саммари");
  });

  it("extracts first paragraph when extractParagraph=true", async () => {
    mockZenSuccess("Первый параграф.\n\nВторой параграф.\n\nТретий параграф.");
    const { chatCompletion } = await importZen();

    const result = await chatCompletion(
      [{ role: "user", content: "test" }],
      { extractParagraph: true },
    );

    expect(result).toBe("Первый параграф.");
  });

  it("returns full text when extractParagraph=false", async () => {
    mockZenSuccess("Первый параграф.\n\nВторой параграф.\n\nТретий параграф.");
    const { chatCompletion } = await importZen();

    const result = await chatCompletion(
      [{ role: "user", content: "test" }],
      { extractParagraph: false },
    );

    expect(result).toContain("Первый параграф");
    expect(result).toContain("Третий параграф");
  });

  it("prepends Russian instruction to system message", async () => {
    mockZenSuccess("OK");
    const { chatCompletion } = await importZen();

    await chatCompletion([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "test" },
    ]);

    const callBody = mockFetch.mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.messages[0].role).toBe("system");
    expect(parsed.messages[0].content).toContain("Write ONLY in Russian");
    expect(parsed.messages[0].content).toContain("Be helpful");
  });

  it("sends Authorization header when ZEN_API_KEY is set", async () => {
    mockZenSuccess("OK");
    const { chatCompletion } = await importZen({ ZEN_API_KEY: "my-secret-key" });

    await chatCompletion([{ role: "user", content: "test" }]);

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders["Authorization"]).toBe("Bearer my-secret-key");
  });

  it("does not send Authorization header when ZEN_API_KEY is empty", async () => {
    mockZenSuccess("OK");
    const { chatCompletion } = await importZen({ ZEN_API_KEY: "" });

    await chatCompletion([{ role: "user", content: "test" }]);

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders["Authorization"]).toBeUndefined();
  });

  it("sends correct model in request body", async () => {
    mockZenSuccess("OK");
    const { chatCompletion } = await importZen({ ZEN_MODEL: "zen-pro" });

    await chatCompletion([{ role: "user", content: "test" }]);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe("zen-pro");
  });
});

// ─── checkZenConnection ─────────────────────────────────────────────────────

describe("checkZenConnection", () => {
  it("returns true when API is reachable", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const { checkZenConnection } = await importZen();

    const result = await checkZenConnection();
    expect(result).toBe(true);
  });

  it("returns false when API is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { checkZenConnection } = await importZen();

    const result = await checkZenConnection();
    expect(result).toBe(false);
  });

  it("returns false on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const { checkZenConnection } = await importZen();

    const result = await checkZenConnection();
    expect(result).toBe(false);
  });
});

// ─── summarizeArticle ───────────────────────────────────────────────────────

describe("summarizeArticle", () => {
  it("calls Zen API twice (summary + detailed) in parallel", async () => {
    mockZenSuccess("Исследование показало эффективность нового метода.");
    mockZenSuccess("Авторы propose novel approach для решения проблемы. Методология основана на transformer архитектуре.");
    const { summarizeArticle } = await importZen();

    const result = await summarizeArticle("Test Title", "Test content", "Test Source");

    expect(result.summary).toBe("Исследование показало эффективность нового метода.");
    expect(result.detailedSummary).toContain("Авторы propose");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("includes title and source in prompts", async () => {
    mockZenSuccess("Summary");
    mockZenSuccess("Detailed");
    const { summarizeArticle } = await importZen();

    await summarizeArticle("My Article", "Content here", "ArXiv");

    // Check first call (summary)
    const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const userMsg1 = body1.messages.find((m: { role: string }) => m.role === "user");
    expect(userMsg1.content).toContain("My Article");
    expect(userMsg1.content).toContain("ArXiv");

    // Check second call (detailed)
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
    const userMsg2 = body2.messages.find((m: { role: string }) => m.role === "user");
    expect(userMsg2.content).toContain("My Article");
    expect(userMsg2.content).toContain("ArXiv");
  });
});

// ─── translateTitle ──────────────────────────────────────────────────────────

describe("translateTitle", () => {
  it("calls Zen API and returns translated title", async () => {
    mockZenSuccess("Новый инструмент для ИИ");
    const { translateTitle } = await importZen();

    const result = await translateTitle("New AI Tool");

    expect(result).toBe("Новый инструмент для ИИ");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses extractParagraph=true for title translation", async () => {
    mockZenSuccess("Перевод\n\nЛишний текст");
    const { translateTitle } = await importZen();

    const result = await translateTitle("Title");

    expect(result).toBe("Перевод");
  });
});

// ─── translateArticle ───────────────────────────────────────────────────────

describe("translateArticle", () => {
  it("calls Zen API and returns translated text", async () => {
    mockZenSuccess("Переведённый текст статьи");
    const { translateArticle } = await importZen();

    const result = await translateArticle("Title", "Article content", "Source");

    expect(result).toBe("Переведённый текст статьи");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const userMessage = callBody.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Source");
  });

  it("works without source parameter", async () => {
    mockZenSuccess("Перевод без источника");
    const { translateArticle } = await importZen();

    const result = await translateArticle("Title", "Content");

    expect(result).toBe("Перевод без источника");

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const userMessage = callBody.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).not.toContain("Источник:");
  });

  it("uses extractParagraph=false for full article translation", async () => {
    mockZenSuccess("Параграф 1.\n\nПараграф 2.");
    const { translateArticle } = await importZen();

    const result = await translateArticle("Title", "Content");

    expect(result).toContain("Параграф 1");
    expect(result).toContain("Параграф 2");
  });
});

// ─── Key Pool rotation ──────────────────────────────────────────────────────

describe("key pool rotation", () => {
  it("rotates to the next key on HTTP 429 and succeeds", async () => {
    mockZenError(429, "rate limit exceeded");
    mockZenSuccess("rotated ok");
    const { chatCompletion, getKeyPoolState } = await importZen({
      ZEN_API_KEYS: "key-aaa,key-bbb",
    });

    const result = await chatCompletion([{ role: "user", content: "test" }]);

    expect(result).toBe("rotated ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getKeyPoolState().activeIndex).toBe(1);
    const secondCall = mockFetch.mock.calls[1] as unknown as [string, { headers: Record<string, string> }];
    expect(secondCall[1].headers["Authorization"]).toBe("Bearer key-bbb");
  });

  it("rotates on 401 credits/balance exhaustion", async () => {
    mockZenError(401, '{"type":"error","error":{"type":"CreditsError","message":"No payment method"}}');
    mockZenSuccess("recovered");
    const { chatCompletion } = await importZen({ ZEN_API_KEYS: "k1,k2" });

    const result = await chatCompletion([{ role: "user", content: "test" }]);

    expect(result).toBe("recovered");
  });

  it("does NOT rotate on plain 401 (invalid key) — normal retry path", async () => {
    mockZenError(401, "invalid api key");
    mockZenError(401, "invalid api key");
    mockZenError(401, "invalid api key");
    const { chatCompletion } = await importZen({ ZEN_API_KEYS: "k1,k2" });

    await expect(chatCompletion([{ role: "user", content: "test" }])).rejects.toThrow(
      "chatCompletion failed after 3 attempts",
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 10000);

  it("throws pool-exhausted when every key hits quota", async () => {
    mockZenError(429, "quota exceeded");
    mockZenError(402, "balance depleted");
    const { chatCompletion } = await importZen({ ZEN_API_KEYS: "k1,k2" });

    await expect(chatCompletion([{ role: "user", content: "test" }])).rejects.toThrow(
      "key pool exhausted",
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to legacy ZEN_API_KEY when ZEN_API_KEYS is absent", async () => {
    mockZenSuccess("legacy ok");
    delete process.env.ZEN_API_KEYS;
    const { chatCompletion, getKeyPoolState } = await importZen();

    const result = await chatCompletion([{ role: "user", content: "test" }]);

    expect(result).toBe("legacy ok");
    expect(getKeyPoolState().poolSize).toBe(1);
    const firstCall = mockFetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(firstCall[1].headers["Authorization"]).toBe("Bearer test-key");
  });
});
