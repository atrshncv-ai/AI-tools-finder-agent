import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { translate } from "@vitalets/google-translate-api";
import { getDb } from "./api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = getDb();
  const articles = await db.select().from(news).where(eq(news.status, "published"));

  console.log(`Перевожу ${articles.length} заголовков...\n`);

  for (const article of articles) {
    if (article.language === "ru") continue;

    try {
      const { text: translatedTitle } = await translate(article.title, { to: "ru" });
      await db.update(news).set({ title: translatedTitle }).where(eq(news.id, article.id));
      console.log(`[${article.id}] ${translatedTitle.substring(0, 60)}...`);
    } catch (error) {
      console.error(`[${article.id}] Ошибка: ${error}`);
    }
  }

  console.log("\nГотово!");
}

main().catch(console.error);
