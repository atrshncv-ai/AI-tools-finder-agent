import "dotenv/config";
import * as cheerio from "cheerio";
import { getDb } from "../api/queries/connection";
import { news } from "@db/schema";
import { isNull, eq } from "drizzle-orm";
import { chatCompletion } from "../api/ai/zenClient";

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
    $("script, style, nav, header, footer, aside, iframe, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return text.length > 100 ? text.substring(0, 8000) : null;
  } catch { return null; }
}

async function main() {
  const db = getDb();
  const pending = await db.select().from(news).where(isNull(news.content)).limit(10);
  console.log(`Processing ${pending.length} articles...`);

  let success = 0;
  let failed = 0;

  for (const article of pending) {
    console.log(`\n[${article.id}] ${article.title.substring(0, 60)}`);

    const text = await fetchText(article.originalUrl);
    if (!text) {
      console.log("  SKIP: no text");
      failed++;
      continue;
    }

    try {
      // Summary
      const summary = await chatCompletion([
        { role: "system", content: "Ты - научный редактор. Составь краткое саммари на русском. 3-5 предложений." },
        { role: "user", content: `Название: ${article.title}\n\n${text}` }
      ], { max_tokens: 512, timeoutMs: 120000 });
      console.log(`  Summary: ${summary.substring(0, 80)}...`);

      // Detailed
      const detailed = await chatCompletion([
        { role: "system", content: "Ты - научный редактор. Подробное описание на русском. 10-15 предложений." },
        { role: "user", content: `Название: ${article.title}\n\n${text}` }
      ], { max_tokens: 1024, timeoutMs: 120000 });
      console.log(`  Detailed: ${detailed.substring(0, 80)}...`);

      // Translation
      const translation = await chatCompletion([
        { role: "system", content: "Переведи научную статью на русский язык. Сохрани структуру." },
        { role: "user", content: `Название: ${article.title}\n\n${text}` }
      ], { max_tokens: 2048, timeoutMs: 120000 });
      console.log(`  Translation: ${translation.substring(0, 80)}...`);

      await db.update(news).set({
        summary,
        content: detailed,
        originalContent: text,
        translation,
        updatedAt: new Date(),
      }).where(eq(news.id, article.id));

      console.log(`  SAVED`);
      success++;
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.log(`\nDone! Success: ${success}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
