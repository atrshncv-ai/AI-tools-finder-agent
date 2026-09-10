import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CHEAPEST_GO_MODELS_FIRST,
  DEFAULT_GO_MODEL,
  resolveCheapestGoModel,
} from "./goModels";

// ─── resolveCheapestGoModel ─────────────────────────────────────────────────

describe("resolveCheapestGoModel", () => {
  it("prefers mimo-v2.5 when present in the catalog", () => {
    expect(
      resolveCheapestGoModel(["mimo-v2.5", "deepseek-v4-flash", "glm-5.3-flash", "kimi-k3"]),
    ).toBe("mimo-v2.5");
  });

  it("skips missing models and picks the next cheapest available", () => {
    expect(resolveCheapestGoModel(["glm-5.3-flash", "kimi-k3", "hy3"])).toBe("glm-5.3-flash");
    expect(resolveCheapestGoModel(["kimi-k3", "hy3"])).toBe("kimi-k3");
  });

  it("falls back to mimo-v2.5 when nothing matches", () => {
    expect(resolveCheapestGoModel(["hy3", "gpt-5.6-luna"])).toBe("mimo-v2.5");
  });

  it("falls back to mimo-v2.5 on an empty catalog", () => {
    expect(resolveCheapestGoModel([])).toBe("mimo-v2.5");
  });

  it("curated list starts with mimo-v2.5 and has no duplicates", () => {
    expect(CHEAPEST_GO_MODELS_FIRST[0]).toBe("mimo-v2.5");
    expect(new Set(CHEAPEST_GO_MODELS_FIRST).size).toBe(CHEAPEST_GO_MODELS_FIRST.length);
    expect(DEFAULT_GO_MODEL).toBe("mimo-v2.5");
  });
});

// ─── Go env parsing (zenClient) ─────────────────────────────────────────────
// Dummy key names only — never real secrets.

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

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
});

async function importZenWithGo(envOverrides: Record<string, string> = {}) {
  delete process.env.ZEN_GO_API_KEY;
  delete process.env.ZEN_GO_API_KEYS;
  delete process.env.ZEN_GO_MODEL;
  const defaults: Record<string, string> = {
    ZEN_BASE_URL: "https://api.test-zen.ai/v1",
    ZEN_API_KEY: "test-legacy-key",
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

describe("Go endpoint routing", () => {
  it("is not Go-configured without a Go key (backward compatible)", async () => {
    mockZenSuccess("OK");
    const { isGoConfigured, getEffectiveBaseUrl, chatCompletion } = await importZenWithGo();

    expect(isGoConfigured()).toBe(false);
    expect(getEffectiveBaseUrl()).toBe("https://api.test-zen.ai/v1");

    await chatCompletion([{ role: "user", content: "test" }]);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.test-zen.ai/v1/chat/completions");
  });

  it("routes to the Go endpoint with the Go key and Go model when configured", async () => {
    mockZenSuccess("OK");
    const { isGoConfigured, getEffectiveBaseUrl, getGoModel, chatCompletion } =
      await importZenWithGo({
        ZEN_GO_API_KEYS: "go-dummy-key-1,go-dummy-key-2",
        ZEN_GO_MODEL: "mimo-v2.5",
      });

    expect(isGoConfigured()).toBe(true);
    expect(getEffectiveBaseUrl()).toBe("https://opencode.ai/zen/go/v1");
    expect(getGoModel()).toBe("mimo-v2.5");

    await chatCompletion([{ role: "user", content: "test" }]);

    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(init.headers["Authorization"]).toBe("Bearer go-dummy-key-1");
    expect(JSON.parse(init.body).model).toBe("mimo-v2.5");
  });

  it("accepts the legacy single ZEN_GO_API_KEY as a Go pool of one", async () => {
    mockZenSuccess("OK");
    const { isGoConfigured, getKeyPoolState, chatCompletion } = await importZenWithGo({
      ZEN_GO_API_KEY: "go-dummy-single",
    });

    expect(isGoConfigured()).toBe(true);
    expect(getKeyPoolState().poolSize).toBe(1);

    await chatCompletion([{ role: "user", content: "test" }]);
    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers["Authorization"]).toBe("Bearer go-dummy-single");
  });

  it("rotates across the Go key pool on quota errors", async () => {
    mockZenError(429, "rate limit exceeded");
    mockZenSuccess("rotated ok");
    const { chatCompletion, getKeyPoolState } = await importZenWithGo({
      ZEN_GO_API_KEYS: "go-dummy-key-1,go-dummy-key-2",
    });

    const result = await chatCompletion([{ role: "user", content: "test" }]);

    expect(result).toBe("rotated ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(getKeyPoolState().activeIndex).toBe(1);
    const [, secondInit] = mockFetch.mock.calls[1] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(secondInit.headers["Authorization"]).toBe("Bearer go-dummy-key-2");
  });
});
