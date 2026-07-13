import pLimit from "p-limit";
import { encode, decode } from "gpt-tokenizer";

// ─── Configuration (all from env vars) ──────────────────────────────────────

const ZEN_BASE_URL = process.env.ZEN_BASE_URL || "https://api.opencode Zen.ai/v1";
const ZEN_API_KEY = process.env.ZEN_API_KEY || "";
const DEFAULT_MODEL = process.env.ZEN_MODEL || "zen-default";

const AI_TIMEOUT_MS = parseInt(process.env.ZEN_TIMEOUT_MS || "120000", 10);
const MAX_INPUT_TOKENS = parseInt(process.env.ZEN_MAX_INPUT_TOKENS || "6000", 10);
const SUMMARY_MAX_TOKENS = parseInt(process.env.ZEN_SUMMARY_MAX_TOKENS || "1024", 10);
const DETAILED_MAX_TOKENS = parseInt(process.env.ZEN_DETAILED_MAX_TOKENS || "2048", 10);
const TRANSLATION_MAX_TOKENS = parseInt(process.env.ZEN_TRANSLATION_MAX_TOKENS || "4096", 10);

const MAX_RETRIES = parseInt(process.env.ZEN_RETRIES || "3", 10);
const INITIAL_RETRY_DELAY_MS = parseInt(process.env.ZEN_RETRY_DELAY_MS || "2000", 10);
const CONCURRENCY = parseInt(process.env.ZEN_CONCURRENCY || "3", 10);

const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.ZEN_CIRCUIT_BREAKER_THRESHOLD || "5", 10);
const CIRCUIT_BREAKER_RESET_MS = parseInt(process.env.ZEN_CIRCUIT_BREAKER_RESET_MS || "60000", 10);

// ─── Token counting (reused from old client) ────────────────────────────────

export function countTokens(text: string): number {
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  try {
    const tokens = encode(text);
    if (tokens.length <= maxTokens) return text;
    const truncated = tokens.slice(0, maxTokens);
    return decode ? decode(truncated) : text.slice(0, maxTokens * 4);
  } catch {
    return text.slice(0, maxTokens * 4);
  }
}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreaker {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  successCount: number;
}

const circuit: CircuitBreaker = {
  state: "closed",
  failureCount: 0,
  lastFailureTime: 0,
  successCount: 0,
};

function circuitRecordSuccess(): void {
  circuit.failureCount = 0;
  circuit.successCount++;
  if (circuit.state === "half-open") {
    circuit.state = "closed";
  }
}

function circuitRecordFailure(): void {
  circuit.failureCount++;
  circuit.lastFailureTime = Date.now();
  if (circuit.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuit.state = "open";
  }
}

function circuitIsOpen(): boolean {
  if (circuit.state !== "open") return false;
  if (Date.now() - circuit.lastFailureTime >= CIRCUIT_BREAKER_RESET_MS) {
    circuit.state = "half-open";
    return false;
  }
  return true;
}

function circuitReset(): void {
  circuit.state = "closed";
  circuit.failureCount = 0;
  circuit.successCount = 0;
  circuit.lastFailureTime = 0;
}

export function getCircuitState(): {
  state: CircuitState;
  failureCount: number;
  successCount: number;
} {
  return {
    state: circuit.state,
    failureCount: circuit.failureCount,
    successCount: circuit.successCount,
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function extractFirstParagraph(text: string): string {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paragraphs[0] || text.trim();
}

function cleanAiOutput(text: string): string {
  if (!text) return text;
  const artifactPatterns = [
    /^\s*\*\*.*Научный редактор.*\*\*\s*$/,
    /^\s*Научный редактор[:\s].*$/i,
    /^\s*КРАТКОЕ\s+САММАРИ[:\s].*$/i,
    /^\s*ПОДРОБНОЕ\s+ОПИСАНИЕ[:\s].*$/i,
  ];
  const lines = text.split("\n");
  while (lines.length > 0 && artifactPatterns.some((p) => p.test(lines[0]))) {
    lines.shift();
  }
  const filtered = lines.filter((line) => !artifactPatterns.some((p) => p.test(line)));
  return filtered.join("\n").trim();
}

// ─── Core API call ──────────────────────────────────────────────────────────

interface CompletionResponse {
  id: string;
  choices: {
    text?: string;
    message?: { role: string; content: string };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const aiLimiter = pLimit(CONCURRENCY);

async function rawChatCompletion(
  messages: { role: string; content: string }[],
  options: {
    temperature?: number;
    max_tokens?: number;
    model?: string;
    extractParagraph?: boolean;
  } = {},
): Promise<string> {
  const {
    temperature = 0.3,
    max_tokens = 2048,
    model = DEFAULT_MODEL,
    extractParagraph = true,
  } = options;

  // Prepend system instruction so model replies in Russian.
  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = [
    {
      role: "system",
      content: `Write ONLY in Russian. ${systemMessage ? systemMessage.content : ""}`.trim(),
    },
    ...messages.filter((m) => m.role !== "system"),
  ];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (ZEN_API_KEY) {
    headers["Authorization"] = `Bearer ${ZEN_API_KEY}`;
  }

  const response = await fetch(`${ZEN_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: chatMessages,
      temperature,
      max_tokens,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Zen API error: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as CompletionResponse;
  const choice = data.choices[0];
  const rawText = (choice?.message?.content ?? choice?.text ?? "").trim();
  const text = cleanAiOutput(rawText);
  return extractParagraph ? extractFirstParagraph(text) : text;
}

/**
 * Main entry point for Zen API calls. Handles retry with exponential backoff
 * and circuit breaker protection.
 */
export async function chatCompletion(
  messages: { role: string; content: string }[],
  options: {
    temperature?: number;
    max_tokens?: number;
    model?: string;
    retries?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    extractParagraph?: boolean;
  } = {},
): Promise<string> {
  const {
    retries = MAX_RETRIES,
    timeoutMs = AI_TIMEOUT_MS,
    retryDelayMs = INITIAL_RETRY_DELAY_MS,
    ...rest
  } = options;

  // Circuit breaker check
  if (circuitIsOpen()) {
    throw new Error(
      `Zen API circuit breaker is OPEN. ${circuit.failureCount} consecutive failures. ` +
        `Retry after ${CIRCUIT_BREAKER_RESET_MS}ms.`,
    );
  }

  return aiLimiter(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await withTimeout(
          rawChatCompletion(messages, rest),
          timeoutMs,
          "Zen API request",
        );
        circuitRecordSuccess();
        return result;
      } catch (error) {
        circuitRecordFailure();
        const isLast = attempt === retries;
        const msg = error instanceof Error ? error.message : String(error);

        if (isLast) {
          throw new Error(`chatCompletion failed after ${retries + 1} attempts: ${msg}`);
        }

        console.log(
          `[Zen] Attempt ${attempt + 1}/${retries + 1} failed, retrying in ${retryDelayMs * Math.pow(2, attempt)}ms...`,
          msg,
        );
        await sleep(retryDelayMs * Math.pow(2, attempt));
      }
    }
    throw new Error("chatCompletion: all retries exhausted");
  });
}

// ─── Domain functions (prompts transferred from old client.ts) ──────────────

/**
 * Summarize an article: produces a brief summary (3-5 sentences) and
 * a detailed summary (10-15 sentences), both in Russian.
 */
export async function summarizeArticle(
  title: string,
  content: string,
  source: string,
): Promise<{ summary: string; detailedSummary: string }> {
  const truncatedContent = truncateToTokens(content, MAX_INPUT_TOKENS);

  const summaryPrompt = [
    {
      role: "system",
      content:
        "Ты помощник по анализу научных статей. Составь краткое саммари статьи на русском языке (3-5 предложений). Сохрани ключевые факты, цифры и термины. Не добавляй оценок. Не повторяй фразы из исходного текста дословно — переформулируй своими словами. Начни сразу с текста саммари. ЗАПРЕЩЕНО писать заголовки, слово 'Научный редактор', 'КРАТКОЕ САММАРИ', 'ПОДРОБНОЕ ОПИСАНИЕ' или любые вступления. Не используй Markdown.",
    },
    {
      role: "user",
      content: `Название: ${title}\nИсточник: ${source}\n\n${truncatedContent}`,
    },
  ];

  const detailedPrompt = [
    {
      role: "system",
      content:
        "Ты помощник по анализу научных статей. Подробно опиши содержание статьи на русском языке (10-15 предложений): методологию, результаты и выводы. Сохрани технические детали. Не повторяй фразы из исходного текста дословно — переформулируй своими словами. Начни сразу с текста описания. ЗАПРЕЩЕНО писать заголовки, слово 'Научный редактор', 'КРАТКОЕ САММАРИ', 'ПОДРОБНОЕ ОПИСАНИЕ' или любые вступления. Не используй Markdown.",
    },
    {
      role: "user",
      content: `Название: ${title}\nИсточник: ${source}\n\n${truncatedContent}`,
    },
  ];

  const [summary, detailedSummary] = await Promise.all([
    chatCompletion(summaryPrompt, {
      temperature: 0.3,
      max_tokens: SUMMARY_MAX_TOKENS,
    }),
    chatCompletion(detailedPrompt, {
      temperature: 0.3,
      max_tokens: DETAILED_MAX_TOKENS,
      extractParagraph: false,
    }),
  ]);

  return { summary, detailedSummary };
}

/**
 * Translate an article title to Russian.
 */
export async function translateTitle(title: string): Promise<string> {
  const prompt = [
    {
      role: "system",
      content:
        "Переведи название научной статьи на русский язык. Выведи ТОЛЬКО перевод названия, без пояснений, без кавычек, без заголовков.",
    },
    { role: "user", content: title },
  ];
  return chatCompletion(prompt, {
    temperature: 0.3,
    max_tokens: 256,
    extractParagraph: true,
  });
}

/**
 * Translate a full article to Russian.
 */
export async function translateArticle(
  title: string,
  content: string,
  source?: string,
): Promise<string> {
  const truncatedContent = truncateToTokens(content, MAX_INPUT_TOKENS);
  const sourceInfo = source ? `\nИсточник: ${source}` : "";

  const prompt = [
    {
      role: "system",
      content:
        "Профессиональный переводчик научных текстов. Переведи статью на русский язык. Сохрани структуру, абзацы, термины в скобках.",
    },
    {
      role: "user",
      content: `Название: ${title}${sourceInfo}\n\n${truncatedContent}`,
    },
  ];

  return chatCompletion(prompt, {
    temperature: 0.3,
    max_tokens: TRANSLATION_MAX_TOKENS,
    extractParagraph: false,
  });
}

/**
 * Check if the Zen API is reachable and healthy.
 */
export async function checkZenConnection(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (ZEN_API_KEY) {
      headers["Authorization"] = `Bearer ${ZEN_API_KEY}`;
    }
    const response = await fetch(`${ZEN_BASE_URL}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reset circuit breaker state (for manual recovery).
 */
export function resetCircuitBreaker(): void {
  circuitReset();
}
