import { translate } from "@vitalets/google-translate-api";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { getDb } from "./api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";

const MAX_CHARS = 4500;

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function main() {
  const db = getDb();
  const article = await db.select().from(news).where(eq(news.id, 2019)).limit(1);

  if (article.length === 0) {
    console.log("Article not found");
    return;
  }

  const text = article[0].originalContent || "";
  console.log(`Article: ${article[0].title.substring(0, 60)}...`);
  console.log(`Content length: ${text.length} chars`);

  const chunks = splitIntoChunks(text, MAX_CHARS);
  console.log(`Chunks: ${chunks.length}`);

  const startTime = Date.now();
  const translatedChunks: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Translating chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
    const { text: translated } = await translate(chunks[i], { to: "ru" });
    translatedChunks.push(translated);
    console.log(`  Done: ${translated.length} chars`);
  }

  const translation = translatedChunks.join("\n\n");
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nTranslation complete in ${elapsed}s`);
  console.log(`Result length: ${translation.length} chars`);
  console.log(`\nFirst 500 chars:\n${translation.substring(0, 500)}...`);
}

main().catch(console.error);
