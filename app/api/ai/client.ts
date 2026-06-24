import pLimit from "p-limit";
import { encode, decode } from "gpt-tokenizer";

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
const DEFAULT_MODEL = process.env.LM_STUDIO_MODEL || "google/gemma-4-12b-qat";

const AI_TIMEOUT_MS = parseInt(process.env.LM_STUDIO_TIMEOUT_MS || "600000", 10);
const MAX_INPUT_TOKENS = parseInt(process.env.LM_STUDIO_MAX_INPUT_TOKENS || "6000", 10);
const SUMMARY_MAX_TOKENS = parseInt(process.env.LM_STUDIO_SUMMARY_MAX_TOKENS || "1024", 10);
const DETAILED_MAX_TOKENS = parseInt(process.env.LM_STUDIO_DETAILED_MAX_TOKENS || "2048", 10);
const TRANSLATION_MAX_TOKENS = parseInt(process.env.LM_STUDIO_TRANSLATION_MAX_TOKENS || "4096", 10);
const RETRIES = parseInt(process.env.LM_STUDIO_RETRIES || "3", 10);
const RETRY_DELAY_MS = parseInt(process.env.LM_STUDIO_RETRY_DELAY_MS || "5000", 10);
const CONCURRENCY = parseInt(process.env.LM_STUDIO_CONCURRENCY || "1", 10);
const STOP_TOKENS = process.env.LM_STUDIO_STOP_TOKENS
  ? process.env.LM_STUDIO_STOP_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["###", "---", "Примечание:", "*Примечание"];

interface CompletionResponse {
  id: string;
  choices: { text: string; finish_reason: string }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const aiLimiter = pLimit(CONCURRENCY);

function extractFirstParagraph(text: string): string {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return paragraphs[0] || text.trim();
}

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

async function rawChatCompletion(
  messages: { role: string; content: string }[],
  options: {
    temperature?: number;
    max_tokens?: number;
    model?: string;
    extractParagraph?: boolean;
  } = {}
): Promise<string> {
  const { temperature = 0.3, max_tokens = 2048, model = DEFAULT_MODEL, extractParagraph = true } = options;

  const systemMsg = messages.find((m) => m.role === "system");
  const userMsg = messages.find((m) => m.role === "user");
  const systemContent = systemMsg ? systemMsg.content : "";
  const userContent = userMsg?.content || "";
  const prompt = `Write ONLY in Russian.\n\n${systemContent}\n\n${userContent}`.trim();

  const response = await fetch(`${LM_STUDIO_URL}/v1/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      temperature,
      max_tokens,
      stop: STOP_TOKENS,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LM Studio API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as CompletionResponse;
  const text = data.choices[0]?.text?.trim() || "";
  return extractParagraph ? extractFirstParagraph(text) : text;
}

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
  } = {}
): Promise<string> {
  const {
    retries = RETRIES,
    timeoutMs = AI_TIMEOUT_MS,
    retryDelayMs = RETRY_DELAY_MS,
    ...rest
  } = options;

  return aiLimiter(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await withTimeout(rawChatCompletion(messages, rest), timeoutMs, "LM Studio request");
      } catch (error) {
        const isLast = attempt === retries;
        const msg = error instanceof Error ? error.message : String(error);
        if (isLast) throw new Error(`chatCompletion failed after ${retries + 1} attempts: ${msg}`);
        console.log(`[AI] Attempt ${attempt + 1} failed, retrying in ${retryDelayMs}ms...`, msg);
        await sleep(retryDelayMs * Math.pow(2, attempt));
      }
    }
    throw new Error("chatCompletion: all retries exhausted");
  });
}

export async function summarizeArticle(
  title: string,
  content: string,
  source: string
): Promise<{ summary: string; detailedSummary: string }> {
  const truncatedContent = truncateToTokens(content, MAX_INPUT_TOKENS);

  const summaryPrompt = [
    {
      role: "system",
      content:
        "Научный редактор. Составь краткое саммари статьи на русском языке. 3-5 предложений. Сохрани ключевые факты, цифры и термины. Не добавляй оценок.",
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
        "Научный редактор. Подробное описание статьи на русском языке. 10-15 предложений. Опиши методологию, результаты и выводы. Сохрани технические детали.",
    },
    {
      role: "user",
      content: `Название: ${title}\nИсточник: ${source}\n\n${truncatedContent}`,
    },
  ];

  const summary = await chatCompletion(summaryPrompt, { temperature: 0.3, max_tokens: SUMMARY_MAX_TOKENS });
  const detailedSummary = await chatCompletion(detailedPrompt, { temperature: 0.3, max_tokens: DETAILED_MAX_TOKENS, extractParagraph: false });

  return { summary, detailedSummary };
}

export async function translateArticle(
  title: string,
  content: string,
  source?: string
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

  return chatCompletion(prompt, { temperature: 0.3, max_tokens: TRANSLATION_MAX_TOKENS, extractParagraph: false });
}

export async function checkLmStudioConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${LM_STUDIO_URL}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
