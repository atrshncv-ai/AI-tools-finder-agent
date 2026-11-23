import { describe, expect, it, vi } from "vitest";
import {
  TELEGRAM_MAX_ATTEMPTS,
  TELEGRAM_TIMEOUT_MS,
  sendTelegramMessageDetailed,
  type TelegramSendOptions,
} from "./telegram-send";

/** A network-level failure shaped like Node's undici `fetch failed`. */
function fetchFailed(code: string): Error {
  return Object.assign(new Error("fetch failed"), { cause: { code } });
}

/** No real waiting in tests; keeps the whole file instant. */
function noSleep() {
  return vi.fn(async (_ms: number) => {});
}

function options(overrides: Partial<TelegramSendOptions> = {}): TelegramSendOptions {
  return {
    botToken: "TEST_TOKEN",
    // 0.5 means "no jitter": the delays stay exactly at the base values.
    random: () => 0.5,
    sleep: noSleep(),
    log: () => {},
    ...overrides,
  };
}

describe("telegram sender: retry policy", () => {
  it("delivers after two network failures, with three attempts in total", async () => {
    const sleep = noSleep();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(fetchFailed("UND_ERR_CONNECT_TIMEOUT"))
      .mockRejectedValueOnce(fetchFailed("ECONNRESET"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const outcome = await sendTelegramMessageDetailed(
      "hello",
      "42",
      options({ fetchImpl: fetchMock as unknown as typeof fetch, sleep }),
    );

    expect(outcome).toMatchObject({ ok: true, attempts: 3 });
    expect(outcome.failure).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it("stops after five attempts, with exponential backoff and ±20% jitter", async () => {
    const sleep = noSleep();
    const fetchMock = vi.fn().mockRejectedValue(fetchFailed("ECONNRESET"));

    const outcome = await sendTelegramMessageDetailed(
      "hello",
      "42",
      options({ fetchImpl: fetchMock as unknown as typeof fetch, sleep }),
    );

    expect(TELEGRAM_MAX_ATTEMPTS).toBe(5);
    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBe(5);
    expect(outcome.failure?.class).toBe("network");
    expect(outcome.failure?.message).toContain("fetch failed");
    expect(outcome.failure?.message).toContain("ECONNRESET");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const delays = sleep.mock.calls.map(([ms]) => ms as number);
    expect(delays).toHaveLength(4);
    const bases = [1_000, 2_000, 4_000, 8_000];
    delays.forEach((delay, index) => {
      expect(delay).toBeGreaterThanOrEqual(bases[index] * 0.8);
      expect(delay).toBeLessThanOrEqual(bases[index] * 1.2);
    });
  });

  it("respects Retry-After on 429 instead of using its own backoff", async () => {
    const sleep = noSleep();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: false, description: "Too Many Requests: retry after 7" }),
          { status: 429, headers: { "retry-after": "7" } },
        ),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const outcome = await sendTelegramMessageDetailed(
      "hello",
      "42",
      options({ fetchImpl: fetchMock as unknown as typeof fetch, sleep }),
    );

    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7_000]);
  });

  it("retries a 5xx response and delivers on the next attempt", async () => {
    const sleep = noSleep();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const outcome = await sendTelegramMessageDetailed(
      "hello",
      "42",
      options({ fetchImpl: fetchMock as unknown as typeof fetch, sleep }),
    );

    expect(outcome).toMatchObject({ ok: true, attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("fails a 400 immediately, without a single retry, and keeps the reason", async () => {
    const sleep = noSleep();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, description: "Bad Request: chat not found" }),
        { status: 400 },
      ),
    );

    const outcome = await sendTelegramMessageDetailed(
      "hello",
      "42",
      options({ fetchImpl: fetchMock as unknown as typeof fetch, sleep }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBe(1);
    expect(outcome.failure?.class).toBe("client");
    expect(outcome.failure?.status).toBe(400);
    expect(outcome.failure?.message).toContain("chat not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("fails a 403 immediately: the bot is blocked or lacks rights", async () => {
    const sleep = noSleep();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }),
        { status: 403 },
      ),
    );

    const outcome = await sendTelegramMessageDetailed(
      "hi",
      "42",
      options({ fetchImpl: fetchMock as unknown as typeof fetch, sleep }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBe(1);
    expect(outcome.failure?.class).toBe("client");
    expect(outcome.failure?.message).toContain("blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives every attempt its own 20-second timeout signal", async () => {
    expect(TELEGRAM_TIMEOUT_MS).toBe(20_000);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(fetchFailed("ETIMEDOUT"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await sendTelegramMessageDetailed(
      "hello",
      "42",
      options({ fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    const signals = fetchMock.mock.calls.map(
      ([, init]) => (init as RequestInit | undefined)?.signal,
    );
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("logs one summary line with attempts, class and the last error", async () => {
    const log = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Bad Request: chat not found", { status: 400 }));

    await sendTelegramMessageDetailed(
      "hello",
      "42",
      options({
        fetchImpl: fetchMock as unknown as typeof fetch,
        log,
        logPrefix: "[test]",
      }),
    );

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain("[test] chat 42: FAILED");
    expect(line).toContain("attempts 1");
    expect(line).toContain("class client");
    expect(line).toContain("chat not found");
  });
});
