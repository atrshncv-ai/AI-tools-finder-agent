/**
 * telegram-send.ts — the one retrying Telegram sender shared by the morning
 * digest (`daily-digest.ts`) and the welcome flow (`telegram-subscribe.ts`).
 *
 * Why it exists: on 21–22 Nov the owner chat ended with a bare `fetch failed`
 * while the second recipient received the message, and three attempts with 2 s
 * / 4 s pauses did not help. The sender therefore:
 *   - retries up to 5 times with exponential backoff (1, 2, 4, 8 s) and ±20 %
 *     jitter, so retries do not line up with the same network hiccup;
 *   - gives every attempt its own `AbortSignal.timeout(20 s)`: a timed-out
 *     request cannot poison the next one, and a stuck keep-alive socket is
 *     abandoned instead of being reused;
 *   - separates retryable failures (network, 429, 5xx) from fatal ones
 *     (400/401/403 and other 4xx), and honours `Retry-After` on 429;
 *   - reports the attempt count, the last error and its class, so the caller
 *     can write one summary line per recipient.
 */

/** Five attempts: the failure of 21–22 Nov exhausted three. */
export const TELEGRAM_MAX_ATTEMPTS = 5;
/** Each attempt gets a fresh 20-second timeout. */
export const TELEGRAM_TIMEOUT_MS = 20_000;
/** Base pauses after attempts 1–4; the fifth failure is final. */
export const TELEGRAM_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000] as const;
/** ±20 % jitter around every base pause. */
export const TELEGRAM_JITTER = 0.2;

/**
 * `network` — fetch rejected (DNS, reset, TLS, timeout); retry.
 * `rate-limit` — HTTP 429; retry after Retry-After when present.
 * `server` — HTTP 5xx; retry.
 * `client` — HTTP 4xx other than 429; never retry, the request must be fixed.
 */
export type TelegramErrorClass = "network" | "rate-limit" | "server" | "client";

export interface TelegramFailure {
  class: TelegramErrorClass;
  /** Human-readable last error, safe for the cron log. */
  message: string;
  /** HTTP status when the failure came from a response. */
  status?: number;
  /** Pause demanded by 429, in milliseconds. */
  retryAfterMs?: number;
}

export interface TelegramSendOutcome {
  ok: boolean;
  /** Attempts actually made (1 when the first one succeeded). */
  attempts: number;
  /** The last failure; absent when `ok`. */
  failure?: TelegramFailure;
}

export interface TelegramSendOptions {
  botToken?: string;
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout. A fresh `AbortSignal.timeout` is created each time. */
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: readonly number[];
  jitter?: number;
  /** [0, 1) source for the jitter; 0.5 means "no jitter", used by tests. */
  random?: () => number;
  /** Pause before the next attempt; injected in tests to keep them instant. */
  sleep?: (ms: number) => Promise<void>;
  /** Dashboard URL for the inline button and the body link. */
  dashboardUrl?: string;
  /** Append the dashboard URL to the body when the text lacks it (digest does). */
  appendDashboardUrl?: boolean;
  logPrefix?: string;
  /** Receives exactly one summary line per call; pass a no-op to stay quiet. */
  log?: (message: string) => void;
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function causeCode(err: unknown): string | undefined {
  const cause = (err as { cause?: unknown } | null)?.cause as { code?: unknown } | null | undefined;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

/** One line per recipient: attempts, last error and its class. */
export function describeTelegramOutcome(chatId: string, outcome: TelegramSendOutcome): string {
  const failure = outcome.failure;
  const last = failure ? ` · class ${failure.class} · last error: ${failure.message}` : "";
  return `chat ${chatId}: ${outcome.ok ? "sent" : "FAILED"} · attempts ${outcome.attempts}${last}`;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageBody(responseText: string): string {
  const trimmed = responseText.trim();
  if (!trimmed) return "empty response body";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isJsonRecord(parsed) && typeof parsed.description === "string" && parsed.description.trim()) {
      return parsed.description.trim();
    }
  } catch {
    // Not JSON (proxy page, HTML error): keep the raw snippet below.
  }
  return trimmed.slice(0, 200);
}

/**
 * `Retry-After` is either seconds or an HTTP date. Telegram normally sends
 * seconds; both forms are accepted so a proxy cannot make the retry early.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : undefined;
  }
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Telegram also puts `parameters.retry_after` into the 429 JSON body. */
function retryAfterFromBody(body: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isJsonRecord(parsed)) return undefined;
    const parameters = parsed.parameters;
    if (!isJsonRecord(parameters)) return undefined;
    const seconds = parameters.retry_after;
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? Math.round(seconds * 1_000)
      : undefined;
  } catch {
    return undefined;
  }
}

function classifyResponse(
  status: number,
  body: string,
  retryAfterHeader: string | null,
): TelegramFailure {
  const description = messageBody(body);
  if (status === 429) {
    const retryAfterMs =
      parseRetryAfter(retryAfterHeader) ?? retryAfterFromBody(body);
    return {
      class: "rate-limit",
      status,
      retryAfterMs,
      message: `HTTP 429 Too Many Requests — ${description}`,
    };
  }
  if (status >= 500) {
    return {
      class: "server",
      status,
      message: `HTTP ${status} server error — ${description}`,
    };
  }
  if (status === 400) {
    return {
      class: "client",
      status,
      message: `HTTP 400 Bad Request — ${description}. Not retried: fix chat_id, Markdown or the message text.`,
    };
  }
  if (status === 401) {
    return {
      class: "client",
      status,
      message: `HTTP 401 Unauthorized — ${description}. Not retried: check TELEGRAM_BOT_TOKEN.`,
    };
  }
  if (status === 403) {
    return {
      class: "client",
      status,
      message: `HTTP 403 Forbidden — ${description}. Not retried: the bot is blocked by the chat or lacks rights.`,
    };
  }
  return {
    class: "client",
    status,
    message: `HTTP ${status} client error — ${description}. Not retried.`,
  };
}

function classifyNetworkError(err: unknown, timeoutMs: number): TelegramFailure {
  const error = err as Error | null;
  const name = error?.name ?? "";
  const raw = error?.message || String(err);
  const timedOut = name === "TimeoutError" || name === "AbortError" || /timed?\s?out/i.test(raw);
  const message = timedOut ? `request timed out after ${timeoutMs} ms` : raw;
  const code = causeCode(err);
  return { class: "network", message: code ? `${message} (cause ${code})` : message };
}

/** Base pause for this attempt ± jitter; attempt 1 uses the 1 s base. */
function jitteredBackoff(
  backoff: readonly number[],
  attempt: number,
  jitter: number,
  random: () => number,
): number {
  const base = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
  const fraction = Math.min(1, Math.max(0, random()));
  const factor = 1 + (fraction * 2 - 1) * jitter;
  return Math.max(0, Math.round(base * factor));
}

function buildPayload(
  text: string,
  chatId: string,
  dashboardUrl: string,
  appendDashboardUrl: boolean,
): string {
  const bodyText =
    dashboardUrl && appendDashboardUrl && !text.includes(dashboardUrl)
      ? `${text}\n${dashboardUrl}`
      : text;
  return JSON.stringify({
    chat_id: chatId,
    text: bodyText,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...(dashboardUrl
      ? { reply_markup: { inline_keyboard: [[{ text: "📊 Открыть дашборд", url: dashboardUrl }]] } }
      : {}),
  });
}

/**
 * Send one Markdown message to one chat. Never throws: the outcome carries the
 * attempt count and the last failure so the caller can keep going with the
 * other recipients and log a single summary line.
 */
export async function sendTelegramMessageDetailed(
  text: string,
  chatId: string,
  options: TelegramSendOptions = {},
): Promise<TelegramSendOutcome> {
  const token = (options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const doFetch = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? TELEGRAM_MAX_ATTEMPTS));
  const timeoutMs = options.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
  const backoff = options.backoffMs ?? TELEGRAM_BACKOFF_MS;
  const jitter = Math.max(0, options.jitter ?? TELEGRAM_JITTER);
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? sleepDefault;
  const log = options.log ?? ((message: string) => console.error(message));
  const prefix = options.logPrefix ?? "[telegram-send]";
  const dashboardUrl = (options.dashboardUrl ?? "").trim();
  const payload = buildPayload(
    text,
    chatId,
    dashboardUrl,
    options.appendDashboardUrl ?? true,
  );
  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;

  let failure: TelegramFailure | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        // Created inside the loop on purpose: every attempt starts with a
        // fresh signal, so a previous timeout cannot abort this request.
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const outcome: TelegramSendOutcome = { ok: true, attempts: attempt };
        log(`${prefix} ${describeTelegramOutcome(chatId, outcome)}`);
        return outcome;
      }
      let body = "";
      try {
        body = await res.text();
      } catch {
        body = "<unreadable body>";
      }
      failure = classifyResponse(res.status, body, res.headers.get("retry-after"));
    } catch (err) {
      failure = classifyNetworkError(err, timeoutMs);
    }

    if (failure.class === "client" || attempt === maxAttempts) {
      const outcome: TelegramSendOutcome = { ok: false, attempts: attempt, failure };
      log(`${prefix} ${describeTelegramOutcome(chatId, outcome)}`);
      return outcome;
    }

    // 429's Retry-After is a demand, not a suggestion: wait at least that long,
    // and never less than the normal backoff for this attempt. The jittered
    // backoff is the delay when Telegram did not say how long to wait.
    const backoffDelay = jitteredBackoff(backoff, attempt, jitter, random);
    const delay =
      failure.retryAfterMs != null
        ? Math.max(failure.retryAfterMs, backoffDelay)
        : backoffDelay;
    await sleep(delay);
  }

  // The loop always returns; this keeps the contract explicit for TypeScript.
  const outcome: TelegramSendOutcome = {
    ok: false,
    attempts: maxAttempts,
    failure: failure ?? { class: "network", message: "unknown Telegram failure" },
  };
  log(`${prefix} ${describeTelegramOutcome(chatId, outcome)}`);
  return outcome;
}
