import { randomUUID } from "node:crypto";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  ProviderError,
  type ChatResult,
  type CompleteJson,
  type ProviderErrorClass,
  type TokenUsage,
} from "./types";
import { readProviderEnv, type EnvLookupOptions } from "./env";

/**
 * GigaChat provider: OAuth token cache plus the OpenAI-compatible
 * `/chat/completions` call.
 *
 * The access token lives 30 minutes, so it is cached and refreshed 60 seconds
 * before `expires_at` — the pipeline never pays for a 401 round-trip. A 401 on
 * the chat call (token revoked early) triggers exactly one refresh and retry;
 * everything else leaves the provider as a classified `ProviderError`.
 *
 * Environment constraints, not code concerns: GigaChat requires a Russian IP
 * and Russian root certificates on the host.
 */

export const DEFAULT_GIGACHAT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
export const DEFAULT_GIGACHAT_API_URL =
  "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";
export const DEFAULT_GIGACHAT_SCOPE = "GIGACHAT_API_PERS";
export const DEFAULT_GIGACHAT_MODEL = "GigaChat";
export const DEFAULT_GIGACHAT_TIMEOUT_MS = 120_000;

const TOKEN_EXPIRY_MARGIN_MS = 60_000;
// Fallback when the OAuth response carries no usable `expires_at`: the
// documented token lifetime. The next call retries OAuth instead of failing.
const ASSUMED_TOKEN_TTL_MS = 30 * 60_000;

export type GigachatProviderOptions = EnvLookupOptions & {
  fetch?: typeof fetch;
  now?: () => number;
};

export type GigachatProvider = {
  id: "gigachat";
  completeJson: CompleteJson;
};

type GigachatConfig = {
  clientId: string;
  clientSecret: string;
  scope: string;
  model: string;
  authUrl: string;
  apiUrl: string;
  timeoutMs: number;
};

type CachedToken = {
  token: string;
  expiresAt: number;
  clientId: string;
  scope: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Status classes shared by both calls: credentials, limits, upstream breaks, bad requests. */
function errorClassForStatus(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return "config";
  if (status === 402 || status === 429) return "quota";
  if (status >= 500) return "transient";
  return "content";
}

function httpError(message: string, status: number): ProviderError {
  return new ProviderError("gigachat", errorClassForStatus(status), `${message} (HTTP ${status})`, {
    status,
  });
}

/** Network failures always look transient; the message never repeats the URL or the request. */
function networkError(message: string, cause: unknown): ProviderError {
  const name = cause instanceof Error ? cause.name : "";
  const reason = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error";
  return new ProviderError("gigachat", "transient", `${message} failed (${reason})`);
}

function resolveConfig(options: GigachatProviderOptions): GigachatConfig {
  const values = readProviderEnv(options);
  return {
    clientId: values.GIGACHAT_CLIENT_ID ?? "",
    clientSecret: values.GIGACHAT_CLIENT_SECRET ?? "",
    scope: values.GIGACHAT_SCOPE || DEFAULT_GIGACHAT_SCOPE,
    model: values.GIGACHAT_MODEL || DEFAULT_GIGACHAT_MODEL,
    authUrl: values.GIGACHAT_AUTH_URL || DEFAULT_GIGACHAT_AUTH_URL,
    apiUrl: values.GIGACHAT_API_URL || DEFAULT_GIGACHAT_API_URL,
    timeoutMs: positiveInteger(values.GIGACHAT_TIMEOUT_MS, DEFAULT_GIGACHAT_TIMEOUT_MS),
  };
}

/**
 * `expires_at` is documented in milliseconds. A seconds value is tolerated so a
 * unit mismatch costs an extra OAuth call instead of a failed cycle.
 */
function normalizeExpiresAt(expiresAt: number | undefined, nowMs: number): number {
  if (expiresAt === undefined || expiresAt <= 0) return nowMs + ASSUMED_TOKEN_TTL_MS;
  return expiresAt < 100_000_000_000 ? expiresAt * 1000 : expiresAt;
}

function isTokenFresh(cached: CachedToken, config: GigachatConfig, nowMs: number): boolean {
  return (
    cached.clientId === config.clientId &&
    cached.scope === config.scope &&
    nowMs < cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS
  );
}

function readCompletionText(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) return undefined;
  const message = choices[0].message;
  if (!isRecord(message)) return undefined;
  return readString(message.content);
}

function readUsage(body: unknown): TokenUsage | null {
  if (!isRecord(body) || !isRecord(body.usage)) return null;
  const inputTokens = readNumber(body.usage.prompt_tokens);
  const outputTokens = readNumber(body.usage.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return null;
  return {
    inputTokens: Math.max(0, Math.trunc(inputTokens)),
    outputTokens: Math.max(0, Math.trunc(outputTokens)),
  };
}

export function createGigachatProvider(
  env: GigachatProviderOptions = {},
): GigachatProvider {
  const doFetch = env.fetch ?? fetch;
  const now = env.now ?? Date.now;
  let cachedToken: CachedToken | null = null;

  async function requestToken(config: GigachatConfig): Promise<CachedToken> {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString(
      "base64",
    );
    let response: Response;
    try {
      response = await doFetch(config.authUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          RqUID: randomUUID(),
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: config.scope,
        }).toString(),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw networkError("GigaChat OAuth request", error);
    }

    if (!response.ok) throw httpError("GigaChat OAuth request failed", response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError("gigachat", "content", "GigaChat OAuth response was not JSON");
    }
    const token = isRecord(body) ? readString(body.access_token) : undefined;
    if (!token) {
      throw new ProviderError("gigachat", "config", "GigaChat OAuth response has no access_token");
    }
    const nowMs = now();
    return {
      token,
      expiresAt: normalizeExpiresAt(isRecord(body) ? readNumber(body.expires_at) : undefined, nowMs),
      clientId: config.clientId,
      scope: config.scope,
    };
  }

  async function accessToken(config: GigachatConfig): Promise<string> {
    if (cachedToken && isTokenFresh(cachedToken, config, now())) return cachedToken.token;
    cachedToken = await requestToken(config);
    return cachedToken.token;
  }

  async function postChat(
    config: GigachatConfig,
    token: string,
    args: Parameters<CompleteJson>[0],
  ): Promise<Response> {
    try {
      return await doFetch(config.apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: args.messages,
          max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: args.temperature ?? DEFAULT_TEMPERATURE,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw networkError("GigaChat chat request", error);
    }
  }

  const completeJson: CompleteJson = async (args): Promise<ChatResult> => {
    const config = resolveConfig(env);
    if (!config.clientId || !config.clientSecret) {
      throw new ProviderError(
        "gigachat",
        "config",
        "GigaChat credentials are not configured (GIGACHAT_CLIENT_ID/GIGACHAT_CLIENT_SECRET)",
      );
    }

    let response = await postChat(config, await accessToken(config), args);
    if (response.status === 401) {
      // The token was revoked before `expires_at`: one refresh, no retry loop.
      cachedToken = null;
      response = await postChat(config, await accessToken(config), args);
    }
    if (!response.ok) throw httpError("GigaChat chat request failed", response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError("gigachat", "content", "GigaChat chat response was not JSON");
    }
    const text = readCompletionText(body);
    if (!text) {
      throw new ProviderError("gigachat", "content", "GigaChat returned an empty completion");
    }

    return {
      text,
      provider: "gigachat",
      model: config.model,
      usage: readUsage(body),
    };
  };

  return { id: "gigachat", completeJson };
}
