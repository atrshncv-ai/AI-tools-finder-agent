/**
 * Simple token usage accumulator for AI providers.
 *
 * Used by the pipeline test runner to measure prompt/completion/total tokens
 * consumed by LM Studio and GigaChat.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

const usage: Record<string, TokenUsage> = {
  lmStudio: { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
  gigaChat: { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 },
};

export function recordUsage(
  provider: "lmStudio" | "gigaChat",
  promptTokens: number,
  completionTokens: number,
  totalTokens: number
): void {
  const entry = usage[provider];
  entry.promptTokens += promptTokens;
  entry.completionTokens += completionTokens;
  entry.totalTokens += totalTokens;
  entry.calls += 1;
}

export function getTokenUsage(): Record<string, TokenUsage> {
  return {
    lmStudio: { ...usage.lmStudio },
    gigaChat: { ...usage.gigaChat },
  };
}

export function resetTokenUsage(): void {
  usage.lmStudio = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
  usage.gigaChat = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
}
