import { describe, expect, it, vi } from "vitest";
import { classifyProviderError, createProviderChain, recordUsage } from "./chain";
import {
  ProviderError,
  type ChatResult,
  type CompleteJson,
  type Provider,
  type ProviderId,
} from "./types";

function fakeProvider(id: ProviderId, completeJson: CompleteJson): Provider {
  return { id, completeJson };
}

function answer(provider: ProviderId, text: string): ChatResult {
  return {
    text,
    provider,
    model: `${provider}-model`,
    usage: { inputTokens: 12, outputTokens: 6 },
  };
}

function failing(error: unknown): CompleteJson {
  return async () => {
    throw error;
  };
}

describe("classifyProviderError", () => {
  it("keeps the class a provider already assigned", () => {
    expect(classifyProviderError(new ProviderError("gigachat", "config", "no key", { status: 401 })))
      .toBe("config");
    expect(classifyProviderError(new ProviderError("gigachat", "quota", "limit", { status: 429 })))
      .toBe("quota");
  });

  it("classifies zenClient quota markers as quota", () => {
    const quota = Object.assign(new Error("Zen API quota exhausted (HTTP 429)"), {
      name: "ZenQuotaError",
      status: 429,
    });
    const poolExhausted = Object.assign(new Error("Zen API key pool exhausted"), {
      name: "ZenPoolExhaustedError",
    });

    expect(classifyProviderError(quota)).toBe("quota");
    expect(classifyProviderError(poolExhausted)).toBe("quota");
  });

  it("classifies 5xx and timeouts as transient", () => {
    expect(classifyProviderError(new Error("Zen API error: 502 - bad gateway"))).toBe("transient");
    expect(
      classifyProviderError(new Error("chatCompletion failed after 4 attempts: Zen API error: 503")),
    ).toBe("transient");
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    expect(classifyProviderError(timeout)).toBe("transient");
    expect(classifyProviderError(new Error("fetch failed"))).toBe("transient");
  });

  it("classifies invalid credentials and a missing subscription as config", () => {
    expect(classifyProviderError(new Error("Zen API error: 401 - invalid key"))).toBe("config");
    expect(
      classifyProviderError(
        new Error("OpenCode Go subscription is required (HTTP 403); Go models are unavailable"),
      ),
    ).toBe("config");
  });

  it("classifies rejected requests and unknown failures as content", () => {
    expect(classifyProviderError(new Error("Zen API error: 400 - bad request"))).toBe("content");
    expect(classifyProviderError(new Error("something unexpected"))).toBe("content");
    expect(classifyProviderError("string failure")).toBe("content");
  });
});

describe("createProviderChain", () => {
  it("does not call the second provider on a config error", async () => {
    const opencode = vi.fn(async () => answer("opencode", "should not be used"));
    const chain = createProviderChain({
      providers: [
        fakeProvider(
          "gigachat",
          failing(new ProviderError("gigachat", "config", "invalid key", { status: 401 })),
        ),
        fakeProvider("opencode", opencode),
      ],
    });

    await expect(
      chain.completeJson({ messages: [{ role: "user", content: "Текст" }] }),
    ).rejects.toMatchObject({ name: "ProviderError", errorClass: "config", provider: "gigachat" });
    expect(opencode).not.toHaveBeenCalled();
    expect(chain.lastProvider()).toBeNull();
  });

  it("falls back to OpenCode on a quota error and marks the answer", async () => {
    const onFallback = vi.fn();
    const sink = vi.fn();
    const chain = createProviderChain({
      providers: [
        fakeProvider(
          "gigachat",
          failing(new ProviderError("gigachat", "quota", "rate limit", { status: 429 })),
        ),
        fakeProvider("opencode", async () => answer("opencode", "fallback answer")),
      ],
      usageSink: sink,
      onFallback,
    });

    const result = await chain.completeJson({ messages: [{ role: "user", content: "Текст" }] });

    expect(result.provider).toBe("opencode");
    expect(result.text).toBe("fallback answer");
    expect(chain.lastProvider()).toBe("opencode");
    expect(onFallback).toHaveBeenCalledWith({ from: "gigachat", to: "opencode", errorClass: "quota" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode",
        model: "opencode-model",
        inputTokens: 12,
        outputTokens: 6,
      }),
    );
  });

  it("falls back to OpenCode on a transient (timeout) error", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    const chain = createProviderChain({
      providers: [fakeProvider("gigachat", failing(timeout)), fakeProvider("opencode", async () => answer("opencode", "ok"))],
    });

    const result = await chain.completeJson({ messages: [{ role: "user", content: "Текст" }] });
    expect(result.provider).toBe("opencode");
  });

  it("returns the fallback text untouched so the same JSON validation applies", async () => {
    const opencodeText = '  {"onTopic": true, "section": "science"}\n';
    const chain = createProviderChain({
      providers: [
        fakeProvider("gigachat", failing(new ProviderError("gigachat", "transient", "5xx", { status: 503 }))),
        fakeProvider("opencode", async () => answer("opencode", opencodeText)),
      ],
    });

    const result = await chain.completeJson({ messages: [{ role: "user", content: "Текст" }] });

    expect(result.text).toBe(opencodeText);
    expect(JSON.parse(result.text)).toEqual({ onTopic: true, section: "science" });
  });

  it("reports every failed provider when no provider answers, without upstream bodies", async () => {
    const chain = createProviderChain({
      providers: [
        fakeProvider(
          "gigachat",
          failing(new ProviderError("gigachat", "quota", "rate limit", { status: 429 })),
        ),
        fakeProvider("opencode", failing(new Error("Zen API error: 503 - upstream-body-marker"))),
      ],
    });

    let error: ProviderError | undefined;
    try {
      await chain.completeJson({ messages: [{ role: "user", content: "Текст" }] });
    } catch (caught) {
      error = caught as ProviderError;
    }

    expect(error).toMatchObject({ name: "ProviderError", errorClass: "transient" });
    expect(error?.attempts).toEqual([
      { provider: "gigachat", errorClass: "quota", status: 429 },
      { provider: "opencode", errorClass: "transient", status: 503 },
    ]);
    expect(error?.message).not.toContain("upstream-body-marker");
  });

  it("surfaces config from the second provider as config", async () => {
    const chain = createProviderChain({
      providers: [
        fakeProvider("gigachat", failing(new ProviderError("gigachat", "quota", "limit", { status: 429 }))),
        fakeProvider(
          "opencode",
          failing(new ProviderError("opencode", "config", "subscription required", { status: 403 })),
        ),
      ],
    });

    await expect(
      chain.completeJson({ messages: [{ role: "user", content: "Текст" }] }),
    ).rejects.toMatchObject({ errorClass: "config" });
  });

  it("does not break the answer when the usage sink fails", async () => {
    const sink = vi.fn(() => {
      throw new Error("accounting storage is down");
    });
    const chain = createProviderChain({
      providers: [fakeProvider("gigachat", async () => answer("gigachat", "answer"))],
      usageSink: sink,
    });

    await expect(
      chain.completeJson({ messages: [{ role: "user", content: "Текст" }] }),
    ).resolves.toMatchObject({ text: "answer", provider: "gigachat" });
  });
});

describe("recordUsage", () => {
  it("forwards provider, model and token spend to the sink", async () => {
    const sink = vi.fn();
    await recordUsage(sink, answer("opencode", "text"), new Date("2026-11-10T12:00:00.000Z"));

    expect(sink).toHaveBeenCalledWith({
      at: "2026-11-10T12:00:00.000Z",
      provider: "opencode",
      model: "opencode-model",
      inputTokens: 12,
      outputTokens: 6,
    });
  });

  it("records nothing when the provider reported no usage", async () => {
    const sink = vi.fn();
    await recordUsage(sink, { ...answer("gigachat", "text"), usage: null });
    expect(sink).not.toHaveBeenCalled();
  });
});
