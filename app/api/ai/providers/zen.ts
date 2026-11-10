import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  type ChatMessage,
  type ChatResult,
  type CompleteJson,
  type TokenUsage,
} from "./types";
import { readProviderEnv, type EnvLookupOptions } from "./env";

/**
 * OpenCode provider — a thin adapter over `api/ai/zenClient.ts`.
 *
 * The existing client owns the key pool, the model chain and the Go endpoint;
 * it reads its configuration once, at import time. The adapter therefore:
 *
 * 1. takes a fresh environment snapshot for every call, with `.env` winning
 *    over `process.env`, so a key replaced by `scripts/update-key.sh` reaches
 *    the next step without restarting the loop;
 * 2. applies that snapshot to `process.env` before the client is first
 *    imported, so a fresh pipeline step (one `npx tsx` process per step)
 *    initializes its pools from the new values;
 * 3. leaves the HTTP request, retries and classification to the client.
 *
 * The client exposes no upstream `usage`, so the token spend of a fallback is
 * estimated with the same tokenizer the client uses for its own limits.
 */

export type ZenProviderOptions = EnvLookupOptions;

export type ZenProvider = {
  id: "opencode";
  completeJson: CompleteJson;
};

/** Variables `zenClient` reads at import time; the env file may legitimately change them. */
const CLIENT_ENV_NAMES = /^(ZEN_.*|AGENT_UA)$/;

function applyEnvironmentSnapshot(options: EnvLookupOptions): void {
  const snapshot = readProviderEnv(options);
  for (const [name, value] of Object.entries(snapshot)) {
    if (CLIENT_ENV_NAMES.test(name)) process.env[name] = value;
  }
}

function resolveModel(isGo: boolean, goModel: string): string {
  if (isGo) return goModel;
  // The client's legacy fallback model, which has no exported getter.
  return process.env.ZEN_MODEL || "zen-default";
}

function estimateUsage(
  messages: ChatMessage[],
  text: string,
  countTokens: (text: string) => number,
): TokenUsage {
  return {
    inputTokens: messages.reduce((sum, message) => sum + countTokens(message.content), 0),
    outputTokens: countTokens(text),
  };
}

export function createZenProvider(env: ZenProviderOptions = {}): ZenProvider {
  const completeJson: CompleteJson = async ({
    messages,
    maxTokens,
    temperature,
  }): Promise<ChatResult> => {
    applyEnvironmentSnapshot(env);
    const zen = await import("../zenClient");

    const text = await zen.chatCompletion(messages, {
      temperature: temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      // A JSON answer must not be cut to its first paragraph.
      extractParagraph: false,
    });

    return {
      text,
      provider: "opencode",
      model: resolveModel(zen.isGoConfigured(), zen.getGoModel()),
      usage: estimateUsage(messages, text, zen.countTokens),
    };
  };

  return { id: "opencode", completeJson };
}
