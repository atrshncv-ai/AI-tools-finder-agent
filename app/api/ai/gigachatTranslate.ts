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
