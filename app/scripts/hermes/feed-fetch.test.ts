import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_UA,
  COLLECTOR_UA,
  DEFAULT_MIN_INTERVAL_MS,
  RSS_ACCEPT,
  feedMinIntervalMs,
  fetchFeed,
  resetFeedThrottle,
} from "./feed-fetch";

/**
 * Feeds block by User-Agent and by rate: genengnews answers 200 to the
 * collector UA and 403 to a browser UA, drugdiscoverytrends does the opposite,
 * nature.com throws a transient 406 and arXiv answers 429 when five queries hit
 * it back-to-back. The downloader therefore tries one UA, retries a throttling
 * status once after a pause, then switches UA — and never waits less than
 * FEED_MIN_INTERVAL_MS between requests to the same host.
 */

const RSS_XML =
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
  `<title>Example</title><link>https://example.com</link><description>d</description>` +
  `<item><title>AI tool finds a new antibiotic</title>` +
  `<link>https://example.com/ai-antibiotic</link>` +
  `<pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate>` +
  `<description>Lead paragraph</description></item></channel></rss>`;

/** Minimal fetch Response: the downloader only reads status/ok/text(). */
function reply(status: number, body = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

function headersOf(init?: RequestInit): Headers {
  return new Headers(init?.headers);
}

function userAgentOf(init?: RequestInit): string | null {
  return headersOf(init).get("user-agent");
}

beforeEach(() => {
  resetFeedThrottle();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetFeedThrottle();
});

describe("fetchFeed strategy ladder", () => {
  it("gets the feed with the browser UA after the collector UA is refused", async () => {
    const calls: { ua: string | null; accept: string | null }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const ua = userAgentOf(init);
      calls.push({ ua, accept: headersOf(init).get("accept") });
      return ua === COLLECTOR_UA ? reply(403, "DENIED-BODY-MARKER") : reply(200, RSS_XML);
    });

    const result = await fetchFeed("https://www.genengnews.com/feed/", {
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("<rss");
    expect(result.status).toBe(200);
    expect(result.strategy).toBe("browser-ua");
    // The accepted request must be the browser-UA one, and the RSS Accept header
    // (nature.com answers 406 without it) travels with every attempt.
    expect(calls.some((call) => call.ua === BROWSER_UA)).toBe(true);
    expect(calls.every((call) => call.accept === RSS_ACCEPT)).toBe(true);
    expect(calls.every((call) => call.ua === COLLECTOR_UA || call.ua === BROWSER_UA)).toBe(true);
  });

  it("retries a 429 once after a pause and accepts the second answer", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? reply(429, "rate limited") : reply(200, RSS_XML);
    });

    const result = await fetchFeed("https://export.arxiv.org/api/query?search_query=cat:cs.AI", {
      fetchImpl,
      minIntervalMs: 0,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1_000);
    expect(sleeps[0]).toBeLessThanOrEqual(2_000);
  });

  it("skips the feed and logs the final status without the response body", async () => {
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => reply(403, "SECRET-RESPONSE-BODY"));

    const result = await fetchFeed("https://www.drugdiscoverytrends.com/feed/", {
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {},
      log: (message: string) => logs.push(message),
    });

    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/403/);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).toMatch(/403/);
    // Logging must stay body-free: no feed content, no HTML block page.
    expect(logs.join("\n")).not.toContain("SECRET-RESPONSE-BODY");
  });

  it("stops at a permanent status instead of hammering every strategy", async () => {
    const fetchImpl = vi.fn(async () => reply(404));

    const result = await fetchFeed("https://example.com/missing.xml", {
      fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {},
      log: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("per-host pacing", () => {
  it("waits FEED_MIN_INTERVAL_MS between two requests to the same host", async () => {
    vi.useFakeTimers();
    resetFeedThrottle();

    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now());
      return reply(200, RSS_XML);
    });
    const deps = { fetchImpl, minIntervalMs: 3_000, log: () => {} };

    await fetchFeed("https://export.arxiv.org/api/query?search_query=cat:cs.AI", deps);
    const second = fetchFeed("https://export.arxiv.org/api/query?search_query=cat:cs.ET", deps);

    // The second arXiv query must still be asleep just before the interval ends.
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2);
    await second;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(3_000);
  });

  it("does not delay a different host", async () => {
    vi.useFakeTimers();
    resetFeedThrottle();

    const fetchImpl = vi.fn(async () => reply(200, RSS_XML));
    const deps = { fetchImpl, minIntervalMs: 3_000, log: () => {} };

    await fetchFeed("https://export.arxiv.org/api/query?search_query=cat:cs.AI", deps);
    await fetchFeed("https://www.nature.com/nature.rss", deps);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("takes the interval from FEED_MIN_INTERVAL_MS with a safe default", () => {
    vi.stubEnv("FEED_MIN_INTERVAL_MS", "1234");
    expect(feedMinIntervalMs()).toBe(1_234);

    vi.stubEnv("FEED_MIN_INTERVAL_MS", "not-a-number");
    expect(feedMinIntervalMs()).toBe(DEFAULT_MIN_INTERVAL_MS);

    vi.stubEnv("FEED_MIN_INTERVAL_MS", "-5");
    expect(feedMinIntervalMs()).toBe(DEFAULT_MIN_INTERVAL_MS);
    expect(DEFAULT_MIN_INTERVAL_MS).toBe(3_000);
  });
});
