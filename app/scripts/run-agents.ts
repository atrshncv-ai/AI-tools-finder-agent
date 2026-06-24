import "dotenv/config";
import { runParseAgent } from "../api/agent/parseAgent";
import { runSummarizeAgent } from "../api/agent/summarizeAgent";
import { initAgentState, initSourceHealthState } from "../api/agent/state";

async function main() {
  await initAgentState(["parse-agent", "summarize-agent"]);
  await initSourceHealthState();
  console.log("Running parse agent...");
  const parseResult = await runParseAgent();
  console.log("Parse result:", JSON.stringify(parseResult, null, 2));
  console.log("Running summarize agent...");
  const summarizeResult = await runSummarizeAgent();
  console.log("Summarize result:", JSON.stringify(summarizeResult, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
