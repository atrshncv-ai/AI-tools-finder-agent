/**
 * Contract shared by every LLM provider in the pipeline.
 *
 * A provider hides HTTP, authorization and retries behind one function:
 * `completeJson` asks for text and gets a `ChatResult` that names the provider
 * and the model that actually answered, plus the token spend of the call.
 * Failures leave the provider as a `ProviderError` carrying an error class, so
 * the chain decides between "try the next provider" (`quota`, `transient`) and
 * "surface the configuration problem" (`config`).
 */

export type ProviderId = "gigachat" | "opencode";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ChatResult = {
  text: string;
  provider: ProviderId;
  model: string;
  usage: TokenUsage | null;
};

export type CompleteJsonArgs = {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type CompleteJson = (args: CompleteJsonArgs) => Promise<ChatResult>;

/**
 * - `config` — bad credentials, no subscription, missing variables (never
 *   retried on another provider: it would hide the cause);
 * - `quota` — rate/balance limit, another provider may still answer;
 * - `transient` — 5xx, timeout, network failure — another provider may answer;
 * - `content` — the provider rejected the request or answered with something
 *   unusable (400/413/422, empty completion); another provider would not help.
 */
export type ProviderErrorClass = "config" | "quota" | "transient" | "content";

export const PROVIDER_ERROR_CLASSES: readonly ProviderErrorClass[] = [
  "config",
  "quota",
  "transient",
  "content",
];

export function isProviderErrorClass(value: unknown): value is ProviderErrorClass {
  return (
    typeof value === "string" && (PROVIDER_ERROR_CLASSES as readonly string[]).includes(value)
  );
}

export type ProviderAttempt = {
  provider: ProviderId;
  errorClass: ProviderErrorClass;
  status?: number;
};

/**
 * A provider failure with a class and no upstream response body: error bodies
 * may echo credentials, so diagnostics keep only the provider, status and class.
 */
export class ProviderError extends Error {
  readonly provider: ProviderId | null;
  readonly errorClass: ProviderErrorClass;
  readonly status?: number;
  readonly attempts?: readonly ProviderAttempt[];

  constructor(
    provider: ProviderId | null,
    errorClass: ProviderErrorClass,
    message: string,
    options: { status?: number; attempts?: readonly ProviderAttempt[] } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.errorClass = errorClass;
    if (options.status !== undefined) this.status = options.status;
    if (options.attempts !== undefined) this.attempts = options.attempts;
  }
}

/** Duck-typed check: survives duplicated module instances (tests, bundlers). */
export function isProviderError(value: unknown): value is ProviderError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { errorClass?: unknown };
  return isProviderErrorClass(candidate.errorClass);
}

/** One provider ready to be placed in the chain. */
export type Provider = {
  id: ProviderId;
  completeJson: CompleteJson;
};

/** Same sampling defaults for both providers, so a switch changes nothing but the backend. */
export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_TEMPERATURE = 0.3;
