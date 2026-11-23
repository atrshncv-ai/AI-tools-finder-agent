/**
 * feed-fetch.ts — one resilient downloader for every RSS/Atom feed.
 *
 * Publishers block by User-Agent, by Accept and by request rate, and each one
 * blocks a different way: genengnews serves 200 to `science-agent/2.0` but 403
 * to a browser UA, drugdiscoverytrends does the opposite, nature.com throws a
 * transient 406 without an XML Accept header, arXiv answers 429 when five
 * queries arrive back-to-back and cell.com occasionally answers 522 from
 * Cloudflare. rss-parser's own downloader had a single fixed UA and no pacing,
 * so those sources silently vanished from the digest.
 *
 * The ladder: collector UA + RSS Accept → (one retry of a throttling/transient
 * status after a pause) → browser UA + RSS Accept. 403/406/429 are retried
 * because they are also handed out per request by WAFs; a 429 pause grows with
 * every consecutive 429 from the same host, so an arXiv burst backs off instead
 * of repeating the same second. Permanent statuses (404/410/…) stop the ladder
 * at once. Every request to one host keeps `FEED_MIN_INTERVAL_MS` (3000 ms)
 * distance from the previous one.
 *
 * Only the final status and the strategy are logged: response bodies (block
 * pages, HTML challenge screens) never reach the log or the health table.
 * Parsing stays in the caller — this module returns text, never items.
 */

import { ssrfCheck } from "../../api/lib/url-safety";

/** Dedicated UA; several publishers allow it and refuse a browser UA. */
export const COLLECTOR_UA = "science-agent/2.0";

/** Browser UA: some publishers (science.org, reddit) refuse a bot UA instead. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * nature.com answers 406 when a request asks for HTML; declaring RSS/XML first
 * is what makes it serve the feed.
 */
export const RSS_ACCEPT = "application/rss+xml, application/xml;q=0.9, */*;q=0.8";

/** Minimum distance between two requests to the same host (arXiv 429 guard). */
export const DEFAULT_MIN_INTERVAL_MS = 3_000;

const FETCH_TIMEOUT_MS = 20_000;
/** One retry per UA, so a failing feed costs at most four requests. */
const MAX_ATTEMPTS_PER_STRATEGY = 2;
const RETRY_BASE_MS = 1_500;
const MAX_RETRY_DELAY_MS = 8_000;

/**
 * Statuses worth a second identical request: rate limits, WAF/UA blocks and
 * Cloudflare's 52x family. Everything else (404, 410, 400, 451 …) is permanent.
 */
const RETRYABLE_STATUSES = new Set([403, 406, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

export type FeedStrategy = "collector-ua" | "browser-ua";

interface Strategy {
  name: FeedStrategy;
  userAgent: string;
}

const STRATEGIES: readonly Strategy[] = [
  { name: "collector-ua", userAgent: COLLECTOR_UA },
  { name: "browser-ua", userAgent: BROWSER_UA },
];

export interface FeedAttempt {
  strategy: FeedStrategy;
  /** null when the request failed below HTTP (DNS, reset, timeout). */
  status: number | null;
  error: string | null;
}

export interface FeedFetchResult {
  ok: boolean;
  /** Response body on success; null on failure — bodies are never logged. */
  text: string | null;
  status: number | null;
  strategy: FeedStrategy | null;
  attempts: FeedAttempt[];
  /** Body-free reason, safe for `sources.last_error`. */
  error: string | null;
}

export interface FeedFetchDeps {
  /** Stub in tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Override `FEED_MIN_INTERVAL_MS` (0 disables pacing for tests). */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Stub in tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Stub in tests; defaults to console.error. */
  log?: (message: string) => void;
}

/** Last request start per host, shared across feeds of one collection run. */
const lastRequestAt = new Map<string, number>();
/** Consecutive 429s per host; drives the growing arXiv pause. */
const hostRateLimitStrikes = new Map<string, number>();

/** Between test cases: forget pacing and 429 history. */
export function resetFeedThrottle(): void {
  lastRequestAt.clear();
  hostRateLimitStrikes.clear();
}

/** `FEED_MIN_INTERVAL_MS`, falling back to the default when unset or invalid. */
export function feedMinIntervalMs(): number {
  const raw = (process.env.FEED_MIN_INTERVAL_MS ?? "").trim();
  if (!raw) return DEFAULT_MIN_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_MIN_INTERVAL_MS;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function sleep(ms: number, deps: FeedFetchDeps): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (deps.sleep) return deps.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait out the rest of the per-host interval, then reserve the slot. The map is
 * enough for the collector's sequential loop; it is not a scheduler for
 * concurrent fetches.
 */
async function paceHost(host: string, minIntervalMs: number, deps: FeedFetchDeps): Promise<void> {
  if (minIntervalMs > 0) {
    const previous = lastRequestAt.get(host);
    if (previous !== undefined) {
      const wait = previous + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait, deps);
    }
  }
  lastRequestAt.set(host, Date.now());
}

/**
 * Pause before retrying. A 429 from arXiv gets longer on every consecutive hit
 * from the same host (1.5 s, 3 s, 6 s, capped at 8 s), a plain WAF/406 retry
 * stays at the base pause.
 */
function retryDelayMs(host: string, status: number | null): number {
  if (status !== 429) return RETRY_BASE_MS;
  const strikes = hostRateLimitStrikes.get(host) ?? 0;
  hostRateLimitStrikes.set(host, strikes + 1);
  return Math.min(MAX_RETRY_DELAY_MS, RETRY_BASE_MS * 2 ** strikes);
}

interface AttemptOutcome {
  ok: boolean;
  status: number | null;
  text: string | null;
  error: string | null;
}

async function requestOnce(
  url: string,
  strategy: Strategy,
  deps: FeedFetchDeps,
): Promise<AttemptOutcome> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  try {
    const response = await doFetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS),
      headers: { "User-Agent": strategy.userAgent, Accept: RSS_ACCEPT },
    });
    if (!response.ok) {
      // The body is deliberately not read: it is a block page, not a feed.
      return { ok: false, status: response.status, text: null, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, text: await response.text(), error: null };
  } catch (err) {
    const detail = ((err as Error).message || "network error").slice(0, 120);
    return { ok: false, status: null, text: null, error: detail };
  }
}

/**
 * Download one feed, trying every strategy. Never throws: a total failure is a
 * result the collector turns into a skipped feed plus a health record, so one
 * blocked publisher cannot stop the run.
 */
export async function fetchFeed(url: string, deps: FeedFetchDeps = {}): Promise<FeedFetchResult> {
  const log = deps.log ?? ((message: string) => console.error(message));
  const host = hostOf(url);

  const blocked = ssrfCheck(url);
  if (blocked) {
    const error = `ssrf-blocked: ${blocked}`;
    log(`[feed-fetch] ${host}: skipped (${error})`);
    return { ok: false, text: null, status: null, strategy: null, attempts: [], error };
  }

  const minIntervalMs = deps.minIntervalMs ?? feedMinIntervalMs();
  const attempts: FeedAttempt[] = [];

  for (const strategy of STRATEGIES) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_STRATEGY; attempt++) {
      await paceHost(host, minIntervalMs, deps);
      const outcome = await requestOnce(url, strategy, deps);
      attempts.push({ strategy: strategy.name, status: outcome.status, error: outcome.error });

      if (outcome.ok && outcome.text !== null) {
        hostRateLimitStrikes.delete(host);
        log(`[feed-fetch] ${host}: HTTP ${outcome.status} via ${strategy.name}`);
        return {
          ok: true,
          text: outcome.text,
          status: outcome.status,
          strategy: strategy.name,
          attempts,
          error: null,
        };
      }

      const retryable = outcome.status === null || RETRYABLE_STATUSES.has(outcome.status);
      if (!retryable) {
        const error = outcome.error ?? `HTTP ${outcome.status}`;
        log(`[feed-fetch] ${host}: ${error} via ${strategy.name} — permanent, giving up`);
        return {
          ok: false,
          text: null,
          status: outcome.status,
          strategy: strategy.name,
          attempts,
          error,
        };
      }

      if (attempt + 1 < MAX_ATTEMPTS_PER_STRATEGY) {
        const delay = retryDelayMs(host, outcome.status);
        log(
          `[feed-fetch] ${host}: ${outcome.error} via ${strategy.name}, retrying in ${delay} ms`,
        );
        await sleep(delay, deps);
      } else {
        log(`[feed-fetch] ${host}: ${outcome.error} via ${strategy.name}, switching strategy`);
      }
    }
  }

  const last = attempts[attempts.length - 1];
  const error = `${last?.error ?? "feed unavailable"} after ${attempts.length} attempts`;
  log(`[feed-fetch] ${host}: giving up (${error})`);
  return {
    ok: false,
    text: null,
    status: last?.status ?? null,
    strategy: last?.strategy ?? null,
    attempts,
    error,
  };
}
