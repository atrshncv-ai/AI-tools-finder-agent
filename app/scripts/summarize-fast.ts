import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { news } from "@db/schema";
import { isNull, eq } from "drizzle-orm";
import { chatCompletion } from "../api/ai/zenClient";
import * as cheerio from "cheerio";

const BATCH = 10;
const INPUT_LIMIT = 2000;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
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
  console.log(`Processing ${pending.length} articles (max ${INPUT_LIMIT} chars)...\n`);

  for (let i = 0; i < pending.length; i++) {
    const article = pending[i];
    console.log(`[${i + 1}/${pending.length}] ${article.title.substring(0, 60)}`);

    const text = await fetchText(article.originalUrl);
    if (!text) { console.log("  SKIP\n"); continue; }
    console.log(`  Text: ${text.length}ch`);

    try {
      const summary = await chatCompletion([
        { role: "system", content: "Научный редактор. Составь саммари на русском. 3 предложения." },
        { role: "user", content: `${article.title}\n\n${text}` }
      ], { max_tokens: 512, timeoutMs: 180000 });

      const translation = await chatCompletion([
        { role: "system", content: "Переведи на русский. Сохрани структуру и термины." },
        { role: "user", content: `${article.title}\n\n${text}` }
      ], { max_tokens: 2048, timeoutMs: 300000 });

      await db.update(news).set({
        summary,
        content: summary,
        translation
      }).where(eq(news.id, article.id));

      console.log(`  OK: ${summary.length}ch + ${translation.length}ch\n`);
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  console.log("Done!");
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
