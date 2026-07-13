import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { news } from "@db/schema";
import { isNull, eq } from "drizzle-orm";
import { chatCompletion } from "../api/ai/zenClient";
import * as cheerio from "cheerio";

const BATCH = 5;
const INPUT_LIMIT = 8000;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000),
    });
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "";
    const charset = ct.match(/charset=([^\s;]+)/i)?.[1] || "utf-8";
    const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
    const html = decoder.decode(buf);
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, aside").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return text.length > 100 ? text.substring(0, INPUT_LIMIT) : null;
  } catch { return null; }
}

async function main() {
  const db = getDb();
  const pending = await db.select().from(news).where(isNull(news.content)).limit(BATCH);
  console.log(`Processing ${pending.length} articles (input limit: ${INPUT_LIMIT} chars)...\n`);

  for (let i = 0; i < pending.length; i++) {
    const article = pending[i];
    console.log(`[${i + 1}/${pending.length}] ${article.title.substring(0, 60)}`);

    const text = await fetchText(article.originalUrl);
    if (!text) { console.log("  SKIP: no text\n"); continue; }
    console.log(`  Text: ${text.length} chars`);

    try {
      const summary = await chatCompletion([
        { role: "system", content: "Ты - научный редактор. Составь краткое саммари статьи на русском языке. 3-5 предложений." },
        { role: "user", content: `Название: ${article.title}\n\n${text}` }
      ], { max_tokens: 1024, timeoutMs: 300000 });
      console.log(`  Summary: ${summary.length}ch`);

      const detailed = await chatCompletion([
        { role: "system", content: "Ты - научный редактор. Подробное описание статьи на русском. 10-15 предложений." },
        { role: "user", content: `Название: ${article.title}\n\n${text}` }
      ], { max_tokens: 2048, timeoutMs: 300000 });
      console.log(`  Detailed: ${detailed.length}ch`);

      const translation = await chatCompletion([
        { role: "system", content: "Переведи научную статью на русский язык. Сохрани структуру и термины." },
        { role: "user", content: `Название: ${article.title}\n\n${text}` }
      ], { max_tokens: 4096, timeoutMs: 600000 });
      console.log(`  Translation: ${translation.length}ch`);

      await db.update(news).set({ summary, content: detailed, translation }).where(eq(news.id, article.id));
      console.log(`  SAVED\n`);
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  console.log("Done!");
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
