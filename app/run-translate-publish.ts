import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { runTranslateAgent } from "./api/agent/translateAgent";
import { runDeployAgent } from "./api/agent/deployAgent";
import { getDb } from "./api/queries/connection";
import { news } from "@db/schema";
import { eq, count } from "drizzle-orm";

async function main() {
  const db = getDb();

  console.log("=== Перевод и публикация ===\n");

  const t1 = Date.now();
  const translateResult = await runTranslateAgent(40);
  const transTime = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`Переведено: ${translateResult.translated} за ${transTime}s`);

  const t2 = Date.now();
  const deployResult = await runDeployAgent();
  const pubTime = ((Date.now() - t2) / 1000).toFixed(1);
  console.log(`Опубликовано: ${deployResult.deployed} за ${pubTime}s`);

  await db.execute(
    `UPDATE news SET "modelUsed" = 'google/gemma-4-e4b (test)' WHERE status = 'published' AND "modelUsed" IS NULL`
  );

  const [total] = await db.select({ c: count() }).from(news).where(eq(news.status, "published"));
  console.log(`\nВсего опубликовано: ${total.c}`);
}

main().catch(console.error);
