import "dotenv/config";
import { runSummarizeAgent } from "../api/agent/summarizeAgent";
import { runTranslateAgent } from "../api/agent/translateAgent";
import { runDeployAgent } from "../api/agent/deployAgent";
import { checkZenConnection } from "../api/ai/zenClient";

async function main() {
  console.log("=== Test Pipeline (skip parse) ===\n");

  // Check Zen API availability
  const zenOk = await checkZenConnection();
  console.log("Zen API:", zenOk ? "AVAILABLE" : "NOT AVAILABLE");
  if (!zenOk) {
    console.log("Check ZEN_BASE_URL and ZEN_API_KEY, then try again.");
    process.exit(1);
  }

  // Stage 1: Summarize
  console.log("\n--- Stage 1: Summarize ---");
  const startTime1 = Date.now();
  const summarizeResult = await runSummarizeAgent();
  const duration1 = ((Date.now() - startTime1) / 1000).toFixed(1);
  console.log(`Done in ${duration1}s: ${summarizeResult.summarized} summarized, ${summarizeResult.errors.length} errors`);
  if (summarizeResult.errors.length > 0) {
    console.log("Errors:", summarizeResult.errors.slice(0, 3));
  }

  // Stage 2: Translate
  console.log("\n--- Stage 2: Translate ---");
  const startTime2 = Date.now();
  const translateResult = await runTranslateAgent();
  const duration2 = ((Date.now() - startTime2) / 1000).toFixed(1);
  console.log(`Done in ${duration2}s: ${translateResult.translated} translated, ${translateResult.errors.length} errors`);
  if (translateResult.errors.length > 0) {
    console.log("Errors:", translateResult.errors.slice(0, 3));
  }

  // Stage 3: Deploy
  console.log("\n--- Stage 3: Deploy ---");
  const startTime3 = Date.now();
  const deployResult = await runDeployAgent();
  const duration3 = ((Date.now() - startTime3) / 1000).toFixed(1);
  console.log(`Done in ${duration3}s: ${deployResult.deployed} deployed`);

  // Summary
  const totalDuration = ((Date.now() - startTime1) / 1000).toFixed(1);
  console.log("\n=== Results ===");
  console.log(`Total time: ${totalDuration}s`);
  console.log(`Summarized: ${summarizeResult.summarized}`);
  console.log(`Translated: ${translateResult.translated}`);
  console.log(`Deployed: ${deployResult.deployed}`);
  console.log(`Errors: ${summarizeResult.errors.length + translateResult.errors.length}`);
}

main().catch((err) => {
  console.error("Pipeline test failed:", err);
  process.exit(1);
});
