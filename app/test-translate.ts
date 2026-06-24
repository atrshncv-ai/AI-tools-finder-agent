import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import { runTranslateAgent } from "./api/agent/translateAgent";

async function main() {
  console.log("=== Перевод 5 статей (qwen/qwen3.5-9b) ===\n");

  const t = Date.now();
  const result = await runTranslateAgent(5);
  const elapsed = ((Date.now() - t) / 1000).toFixed(1);

  console.log(`\nПереведено: ${result.translated} за ${elapsed}s`);
  if (result.errors.length > 0) {
    console.log("Ошибки:");
    for (const e of result.errors) console.log(`  ${e}`);
  }
}

main().catch((error) => {
  console.error("Ошибка:", error);
  process.exit(1);
});
