import "dotenv/config";
import * as cheerio from "cheerio";
import { getDb } from "../api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";
import { chatCompletion } from "../api/ai/zenClient";

const ARTICLE_ID = 1;
const MAX_TEXT_LENGTH = 1500;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ScienceAgent/1.0)" },
      signal: AbortSignal.timeout(20000),
    });
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "";
    const charset = ct.match(/charset=([^\s;]+)/i)?.[1] || "utf-8";
    const decoder = new TextDecoder(charset === "windows-1251" ? "windows-1251" : "utf-8");
    const html = decoder.decode(buf);
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, aside, iframe, noscript").remove();
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return text.length > 100 ? text : null;
  } catch (e) {
    console.error("Fetch error:", e);
    return null;
  }
}

async function main() {
  const db = getDb();
  const article = await db.query.news.findFirst({
    where: eq(news.id, ARTICLE_ID),
  });

  if (!article) {
    console.error("Article not found");
    process.exit(1);
  }

  console.log(`Processing article #${article.id}: ${article.title}`);
  console.log(`URL: ${article.originalUrl}`);

  const fullText = await fetchText(article.originalUrl);
  if (!fullText) {
    console.error("Failed to fetch article text");
    process.exit(1);
  }

  const text = fullText.substring(0, MAX_TEXT_LENGTH);
  console.log(`\nOriginal text length: ${fullText.length} chars, using first ${text.length}`);

  const userContent = `Название: ${article.title}\nИсточник: ${article.source}\n\n${text}`;

  console.log("\n1. Generating summary...");
  const summary = await chatCompletion([
    { role: "system", content: "Ты - научный редактор. Составь краткое саммари статьи на русском языке. 3-5 предложений. Сохрани ключевые факты, цифры и термины." },
    { role: "user", content: userContent },
  ], { max_tokens: 512, timeoutMs: 120000 });
  console.log("Summary:", summary);

  console.log("\n2. Generating detailed description...");
  const detailedSummary = await chatCompletion([
    { role: "system", content: "Ты - научный редактор. Подробное описание статьи на русском языке. 10-15 предложений. Опиши методологию, результаты и выводы." },
    { role: "user", content: userContent },
  ], { max_tokens: 1024, timeoutMs: 120000 });
  console.log("Detailed:", detailedSummary.substring(0, 300), "...");

  console.log("\n3. Generating translation...");
  const translation = await chatCompletion([
    { role: "system", content: "Ты - профессиональный переводчик научных текстов. Переведи статью на русский язык. Сохрани структуру и абзацы." },
    { role: "user", content: userContent },
  ], { max_tokens: 2048, timeoutMs: 120000 });
  console.log("Translation:", translation.substring(0, 300), "...");

  await db.update(news).set({
    summary,
    content: detailedSummary,
    originalContent: fullText,
    translation,
    updatedAt: new Date(),
  }).where(eq(news.id, article.id));

  console.log("\n✅ Article saved successfully");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
