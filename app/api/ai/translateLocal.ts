/**
 * Local offline translation via Transformers.js (ONNX).
 *
 * Uses a small dedicated translation model (default Xenova/opus-mt-en-ru)
 * instead of a general LLM, so full articles can be translated on a PC
 * without calling any web API.
 *
 * The model is downloaded once by Transformers.js on first use and cached
 * locally. After that, translation works completely offline.
 */

import { logger } from "../lib/logger";

const DEFAULT_MODEL = process.env.LOCAL_TRANSLATE_MODEL || "Xenova/opus-mt-en-ru";
const MAX_CHUNK_CHARS = parseInt(process.env.LOCAL_TRANSLATE_MAX_CHUNK_CHARS || "400", 10);
const DEVICE = process.env.LOCAL_TRANSLATE_DEVICE || "cpu";

type TranslationResult = { translation_text: string };
type TranslationFn = (texts: string[]) => Promise<TranslationResult[]>;

let translator: TranslationFn | null = null;
let initPromise: Promise<void> | null = null;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitIntoChunks(text: string, maxChars: number): string[] {
  if (!text.trim()) return [];
  if (text.length <= maxChars) return [text];

  const sentences = splitSentences(text);
  const chunks: string[] = [];
  let chunk = "";

  const flush = () => {
    if (chunk) {
      chunks.push(chunk);
      chunk = "";
    }
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      const words = sentence.split(/\s+/);
      let wordChunk = "";
      for (const word of words) {
        if (wordChunk.length + word.length + 1 > maxChars) {
          if (wordChunk) chunks.push(wordChunk);
          wordChunk = word;
        } else {
          wordChunk += (wordChunk ? " " : "") + word;
        }
      }
      if (wordChunk) chunks.push(wordChunk);
      continue;
    }

    if (chunk.length + sentence.length + 1 <= maxChars) {
      chunk += (chunk ? " " : "") + sentence;
    } else {
      flush();
      chunk = sentence;
    }
  }

  flush();
  return chunks.length ? chunks : [text.slice(0, maxChars)];
}

async function initTranslator(): Promise<void> {
  if (translator) return;
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    logger.info("Local translate: loading model", { model: DEFAULT_MODEL, device: DEVICE });
    const { pipeline } = await import("@xenova/transformers");
    // Transformers.js types do not expose `device` in PretrainedOptions,
    // but the runtime accepts it.
    translator = (await pipeline("translation", DEFAULT_MODEL, {
      device: DEVICE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as TranslationFn;
    logger.info("Local translate: model loaded", { model: DEFAULT_MODEL });
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function translateLocal(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  await initTranslator();
  const t = translator;
  if (!t) {
    throw new Error("Local translator failed to initialize");
  }

  const chunks = splitIntoChunks(trimmed, MAX_CHUNK_CHARS);
  const results = await t(chunks);

  return results.map((r) => r.translation_text).join(" ");
}
