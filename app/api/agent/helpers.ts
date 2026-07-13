import { monitorSources } from "./sourceMonitor";
import { runParseAgent } from "./parseAgent";
import { runSummarizeAgent } from "./summarizeAgent";
import { getAgentState, getAllSourceHealth } from "./state";
import { logger } from "../lib/logger";
import type { AgentMetrics } from "./types";

/**
 * Manual run: parse all sources + summarize. Used by admin endpoint.
 */
export async function manualRun(): Promise<{
  parseResults: Awaited<ReturnType<typeof runParseAgent>>;
  summarizeResult: Awaited<ReturnType<typeof runSummarizeAgent>>;
}> {
  logger.info("Manual run triggered");
  await monitorSources();
  const parseResults = await runParseAgent();
  const summarizeResult = await runSummarizeAgent();
  return { parseResults, summarizeResult };
}

/**
 * Get current agent metrics and source health.
 */
export function getMetrics(): AgentMetrics {
  const parseState = getAgentState("parse-agent");
  const summarizeState = getAgentState("summarize-agent");

  return {
    totalParsed: parseState.successCount,
    totalSummarized: summarizeState.successCount,
    totalErrors: parseState.failCount + summarizeState.failCount,
    avgParseTime: 0,
    avgSummarizeTime: 0,
    sourcesHealth: getAllSourceHealth(),
  };
}
