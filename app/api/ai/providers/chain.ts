import { createGigachatProvider } from "./gigachat";
import { createZenProvider } from "./zen";
import {
  ProviderError,
  isProviderError,
  type ChatResult,
  type CompleteJson,
  type Provider,
  type ProviderAttempt,
  type ProviderErrorClass,
  type ProviderId,
} from "./types";

/**
 * Provider chain: GigaChat first, OpenCode Go as the fallback.
 *
 * The rule from the specification (§5): a quota (429/402) or transient
 * (5xx/timeout/network) failure moves the call to the next provider; a config
 * failure (401/403, missing credentials, no subscription) never does — a
 * different provider would hide the cause, and the owner has to fix the
 * configuration. Every successful call reports who answered and how many
 * tokens it spent, and that record is handed to the accounting sink.
 */

export type ProviderFallback = {
  from: ProviderId;
  to: ProviderId;
  errorClass: ProviderErrorClass;
};

export type UsageRecord = {
  at: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/** Where token spend goes (pipeline state / report). Failures are best-effort. */
export type UsageSink = (record: UsageRecord) => void | Promise<void>;

export type ProviderChainDeps = {
  /** Ordered providers; defaults to GigaChat then OpenCode. */
  providers?: Provider[];
  usageSink?: UsageSink | null;
  onFallback?: (fallback: ProviderFallback) => void;
};

export type ProviderChain = {
  completeJson: CompleteJson;
  /** Provider of the last successful call; `null` until the first one succeeds. */
  lastProvider(): ProviderId | null;
};

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

/** HTTP status either carried by a typed error or embedded by `zenClient` in its message. */
function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }
  const match = messageOf(error).match(/(?:\bHTTP\s+|error:\s*)(\d{3})\b/i);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return parsed >= 100 && parsed <= 599 ? parsed : undefined;
}

/**
 * Map any provider failure to its class. `zenClient` errors arrive as plain
 * `Error`s with the status in the message (or with a `ZenQuotaError` name), so
 * both shapes are understood without touching the existing client.
 */
export function classifyProviderError(error: unknown): ProviderErrorClass {
  if (isProviderError(error)) return error.errorClass;

  const message = messageOf(error);
  const name = nameOf(error);

  // The Go endpoint answers 403 when the paid subscription is missing: that is
  // account configuration, not key exhaustion, and must not be treated as quota.
  if (/active\s+OpenCode\s+Go\s+subscription\s+is\s+required/i.test(message)) return "config";
  if (name === "ZenQuotaError" || name === "ZenPoolExhaustedError") return "quota";

  const status = statusOf(error);
  if (status !== undefined) {
    if (status === 402 || status === 429) return "quota";
    if (status >= 500) return "transient";
    if (status === 401 || status === 403) return "config";
    if (status >= 400) return "content";
  }

  if (name === "TimeoutError" || name === "AbortError") return "transient";
  if (
    /timed?\s*out|timeout|network|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(
      `${name} ${message}`,
    )
  ) {
    return "transient";
  }
  // Unknown failures do not move to another provider: a bug must stay visible.
  return "content";
}

function describeAttempt(attempt: ProviderAttempt): string {
  const status = attempt.status === undefined ? "" : ` (HTTP ${attempt.status})`;
  return `${attempt.provider}=${attempt.errorClass}${status}`;
}

/**
 * The error the caller sees after a chain of attempts. It never carries an
 * upstream response body (which may echo credentials) — only provider names,
 * classes and statuses.
 */
function failureError(error: unknown, attempts: readonly ProviderAttempt[]): ProviderError {
  if (attempts.length === 1) {
    // The provider already returns a safe, classified error: surface it as is.
    if (isProviderError(error)) return error;
    const attempt = attempts[0];
    return new ProviderError(
      attempt.provider,
      attempt.errorClass,
      `${attempt.provider} failed: ${attempt.errorClass}${attempt.status === undefined ? "" : ` (HTTP ${attempt.status})`}`,
      attempt.status === undefined ? {} : { status: attempt.status },
    );
  }

  const errorClass = attempts.some((attempt) => attempt.errorClass === "config")
    ? "config"
    : attempts[attempts.length - 1].errorClass;
  return new ProviderError(
    attempts[0].provider,
    errorClass,
    `LLM providers failed: ${attempts.map(describeAttempt).join(", ")}`,
    {
      status: attempts[attempts.length - 1].status,
      attempts,
    },
  );
}

/** Hand one successful call to the accounting sink; a storage hiccup must not lose an answer. */
async function recordUsageSafely(
  sink: UsageSink | null | undefined,
  result: ChatResult,
): Promise<void> {
  try {
    await recordUsage(sink, result);
  } catch {
    // best-effort: the answer is more valuable than the counter
  }
}

/** Build the sink record for one call; `null` usage records nothing. */
export function recordUsage(
  sink: UsageSink | null | undefined,
  result: ChatResult,
  at: Date = new Date(),
): void | Promise<void> {
  if (!sink || !result.usage) return;
  return sink({
    at: at.toISOString(),
    provider: result.provider,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
}

export function createProviderChain(deps: ProviderChainDeps = {}): ProviderChain {
  const providers = deps.providers ?? [createGigachatProvider(), createZenProvider()];
  let last: ProviderId | null = null;

  const completeJson: CompleteJson = async (args) => {
    if (providers.length === 0) {
      throw new ProviderError(null, "config", "No LLM providers are configured");
    }

    const attempts: ProviderAttempt[] = [];
    for (let index = 0; index < providers.length; index++) {
      const provider = providers[index];
      try {
        const result = await provider.completeJson(args);
        last = result.provider;
        await recordUsageSafely(deps.usageSink, result);
        return result;
      } catch (error) {
        const errorClass = classifyProviderError(error);
        const status = statusOf(error);
        attempts.push(
          status === undefined
            ? { provider: provider.id, errorClass }
            : { provider: provider.id, errorClass, status },
        );

        const isLastProvider = index === providers.length - 1;
        // A config failure is terminal: the next provider cannot repair bad credentials.
        if (errorClass === "config" || isLastProvider) {
          throw failureError(error, attempts);
        }

        const next = providers[index + 1];
        deps.onFallback?.({ from: provider.id, to: next.id, errorClass });
      }
    }

    // Unreachable: the last iteration either returns or throws.
    throw new ProviderError(null, "config", "No LLM provider answered");
  };

  return { completeJson, lastProvider: () => last };
}
