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
      resolveCheapestGoModel(["deepseek-v4-flash", "hy3", "glm-5.3-flash", "mimo-v2.5"]),
    ).toBe("mimo-v2.5");
  });

  it("skips missing models and picks the next cheapest available", () => {
    expect(resolveCheapestGoModel(["glm-5.3-flash", "deepseek-v4-flash", "hy3"])).toBe("hy3");
    expect(resolveCheapestGoModel(["deepseek-v4-flash", "glm-5.3-flash"])).toBe("glm-5.3-flash");
    expect(resolveCheapestGoModel(["deepseek-v4-flash"])).toBe("deepseek-v4-flash");
  });

  it("ignores kimi-k3 (too expensive, not in the preference list)", () => {
    expect(resolveCheapestGoModel(["kimi-k3", "hy3"])).toBe("hy3");
    expect(resolveCheapestGoModel(["kimi-k3"])).toBe("mimo-v2.5");
  });

  it("falls back to mimo-v2.5 when nothing matches", () => {
    expect(resolveCheapestGoModel(["gpt-5.6-luna", "kimi-k3"])).toBe("mimo-v2.5");
  });

  it("falls back to mimo-v2.5 on an empty catalog", () => {
    expect(resolveCheapestGoModel([])).toBe("mimo-v2.5");
  });

  it("curated list is cheapest-first, has no duplicates, excludes kimi-k3", () => {
    expect([...CHEAPEST_GO_MODELS_FIRST]).toEqual([
      "mimo-v2.5",
      "hy3",
      "glm-5.3-flash",
      "deepseek-v4-flash",
    ]);
    expect(new Set(CHEAPEST_GO_MODELS_FIRST).size).toBe(CHEAPEST_GO_MODELS_FIRST.length);
    expect(CHEAPEST_GO_MODELS_FIRST).not.toContain("kimi-k3");
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
  delete process.env.ZEN_GO_SESSION_ID;
  delete process.env.AGENT_UA;
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

// ─── Go session headers (x-opencode-session + User-Agent) ────────────────────
// Dummy key names only — never real secrets.

describe("Go session headers", () => {
  it("sends User-Agent and x-opencode-session on Go chat completions", async () => {
    mockZenSuccess("OK");
    const { chatCompletion } = await importZenWithGo({
      ZEN_GO_API_KEYS: "go-dummy-key-1",
    });

    await chatCompletion([{ role: "user", content: "test" }], { sessionId: "hermes-123" });

    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers["User-Agent"]).toBe("science-agent/2.0");
    expect(init.headers["x-opencode-session"]).toBe("hermes-123");
  });

  it("uses a stable per-process default when no sessionId is given", async () => {
    mockZenSuccess("OK");
    mockZenSuccess("OK");
    const { chatCompletion } = await importZenWithGo({
      ZEN_GO_API_KEYS: "go-dummy-key-1",
    });

    await chatCompletion([{ role: "user", content: "test" }]);
    await chatCompletion([{ role: "user", content: "test" }]);

    const first = (mockFetch.mock.calls[0] as unknown as [{}, { headers: Record<string, string> }])[1].headers;
    const second = (mockFetch.mock.calls[1] as unknown as [{}, { headers: Record<string, string> }])[1].headers;
    expect(first["x-opencode-session"]).toBeTruthy();
    expect(second["x-opencode-session"]).toBe(first["x-opencode-session"]);
  });

  it("prefixes the session id with ZEN_GO_SESSION_ID when set", async () => {
    mockZenSuccess("OK");
    mockZenSuccess("OK");
    const { chatCompletion } = await importZenWithGo({
      ZEN_GO_API_KEYS: "go-dummy-key-1",
      ZEN_GO_SESSION_ID: "prod",
    });

    await chatCompletion([{ role: "user", content: "test" }], { sessionId: "hermes-7" });
    await chatCompletion([{ role: "user", content: "test" }]);

    const withId = (mockFetch.mock.calls[0] as unknown as [{}, { headers: Record<string, string> }])[1].headers;
    const fallback = (mockFetch.mock.calls[1] as unknown as [{}, { headers: Record<string, string> }])[1].headers;
    expect(withId["x-opencode-session"]).toBe("prod-hermes-7");
    expect(fallback["x-opencode-session"]).toBe("prod");
  });

  it("does NOT send Go headers on legacy (non-Go) requests", async () => {
    mockZenSuccess("OK");
    const { chatCompletion } = await importZenWithGo();

    await chatCompletion([{ role: "user", content: "test" }]);

    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers["x-opencode-session"]).toBeUndefined();
    expect(init.headers["User-Agent"]).toBeUndefined();
  });

  it("summarizeOneShot passes the session id through to chat completions", async () => {
    const payload = JSON.stringify({ title_ru: "Заголовок", summary: "Саммари статьи." });
    mockZenSuccess(payload);
    const { summarizeOneShot } = await importZenWithGo({
      ZEN_GO_API_KEYS: "go-dummy-key-1",
    });

    await summarizeOneShot("Title", "Content", "Source", "hermes-42");

    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers["x-opencode-session"]).toBe("hermes-42");
    expect(init.headers["User-Agent"]).toBe("science-agent/2.0");
  });
});
