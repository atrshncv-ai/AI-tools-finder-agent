/**
 * Translation via GigaChat API.
 *
 * Replaces the local ONNX translation model. The API key is read from
 * GIGACHAT_API_KEY; the model can be configured via GIGACHAT_MODEL
 * (default: "GigaChat").
 */

import GigaChat from "gigachat";
import { Agent } from "node:https";
import pLimit from "p-limit";
import { logger } from "../lib/logger";
import { recordUsage } from "./tokenUsage";

const GIGACHAT_API_KEY = process.env.GIGACHAT_API_KEY;
const GIGACHAT_MODEL = process.env.GIGACHAT_MODEL || "GigaChat";
const GIGACHAT_TIMEOUT = parseInt(process.env.GIGACHAT_TIMEOUT || "120", 10);
const GIGACHAT_RETRIES = parseInt(process.env.GIGACHAT_RETRIES || "3", 10);
const GIGACHAT_CONCURRENCY = parseInt(process.env.GIGACHAT_CONCURRENCY || "1", 10);
const GIGACHAT_MAX_TOKENS = parseInt(process.env.GIGACHAT_MAX_TOKENS || "4096", 10);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let client: GigaChat | null = null;

function getClient(): GigaChat {
  if (!GIGACHAT_API_KEY) {
    throw new Error("GIGACHAT_API_KEY is not set");
  }
  if (!client) {
    client = new GigaChat({
      model: GIGACHAT_MODEL,
      credentials: GIGACHAT_API_KEY,
      timeout: GIGACHAT_TIMEOUT,
      httpsAgent: new Agent({ rejectUnauthorized: false }),
    });
  }
  return client;
}

const gigachatLimiter = pLimit(GIGACHAT_CONCURRENCY);

export async function translateWithGigaChat(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  return gigachatLimiter(async () => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= GIGACHAT_RETRIES; attempt++) {
      try {
        const client = getClient();
        const response = await client.chat({
          model: GIGACHAT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "Ты профессиональный переводчик научных текстов. Переведи предоставленный текст на русский язык. Сохраняй структуру, абзацы и технические термины.",
            },
            { role: "user", content: trimmed },
          ],
          temperature: 0.3,
          max_tokens: GIGACHAT_MAX_TOKENS,
        });

        const translation = response.choices[0]?.message?.content?.trim();
        if (response.usage) {
          recordUsage(
            "gigaChat",
            (response.usage as { prompt_tokens?: number }).prompt_tokens || 0,
            (response.usage as { completion_tokens?: number }).completion_tokens || 0,
            (response.usage as { total_tokens?: number }).total_tokens || 0
          );
        }
        if (!translation) {
          throw new Error("GigaChat returned empty translation");
        }
        return translation;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("GigaChat translation failed", {
          attempt: attempt + 1,
          error: lastError.message,
        });
        if (attempt < GIGACHAT_RETRIES) {
          await sleep(1000 * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  });
}

export interface GigachatSummary {
  summary: string;
  detailedSummary: string;
}

const GIGACHAT_SUMMARY_MAX_CHARS = parseInt(process.env.GIGACHAT_SUMMARY_MAX_CHARS || "12000", 10);

function parseMarkedSummary(raw: string): GigachatSummary {
  const cleaned = raw.replace(/\r\n?/g, "\n").trim();
  const match = cleaned.match(
    /КРАТКОЕ\s*САММАРИ:\s*([\s\S]*?)\s*ПОДРОБНОЕ\s*ОПИСАНИЕ:\s*([\s\S]*)/i
  );
  if (match) {
    return {
      summary: match[1].trim(),
      detailedSummary: match[2].trim(),
    };
  }
  // Fallback: first paragraph = summary, rest = detailed
  const parts = cleaned.split("\n\n").filter(Boolean);
  if (parts.length >= 2) {
    return { summary: parts[0], detailedSummary: parts.slice(1).join("\n\n") };
  }
  return { summary: cleaned, detailedSummary: cleaned };
}

export async function summarizeWithGigaChat(
  title: string,
  content: string,
  source: string
): Promise<GigachatSummary> {
  const truncated = content.slice(0, GIGACHAT_SUMMARY_MAX_CHARS);

  return gigachatLimiter(async () => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= GIGACHAT_RETRIES; attempt++) {
      try {
        const client = getClient();
        const response = await client.chat({
          model: GIGACHAT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "Ты научный редактор. Прочитай статью и выдай результат на русском языке строго в следующем формате (без Markdown, без JSON):\n\nКРАТКОЕ САММАРИ:\n3-5 предложений с ключевыми фактами.\n\nПОДРОБНОЕ ОПИСАНИЕ:\n10-15 предложений, описывающих методологию, результаты и выводы.",
            },
            {
              role: "user",
              content: `Название: ${title}\nИсточник: ${source}\n\n${truncated}`,
            },
          ],
          temperature: 0.3,
          max_tokens: GIGACHAT_MAX_TOKENS,
        });

        if (response.usage) {
          recordUsage(
            "gigaChat",
            (response.usage as { prompt_tokens?: number }).prompt_tokens || 0,
            (response.usage as { completion_tokens?: number }).completion_tokens || 0,
            (response.usage as { total_tokens?: number }).total_tokens || 0
          );
        }

        const raw = response.choices[0]?.message?.content?.trim() || "";
        const parsed = parseMarkedSummary(raw);

        if (!parsed.summary || !parsed.detailedSummary) {
          throw new Error("GigaChat summary response missing fields");
        }

        return parsed;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("GigaChat summarization failed", {
          attempt: attempt + 1,
          error: lastError.message,
        });
        if (attempt < GIGACHAT_RETRIES) {
          await sleep(1000 * Math.pow(2, attempt));
        }
      }
    }

    throw lastError;
  });
}
