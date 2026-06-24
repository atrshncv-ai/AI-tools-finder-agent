import { monitorSources } from "./sourceMonitor";
import { runParseAgent } from "./parseAgent";
import { runSummarizeAgent } from "./summarizeAgent";
import { getAgentState, getAllSourceHealth } from "./state";
import { logger } from "../lib/logger";
import type { AgentMetrics } from "./types";

interface OrchestratorConfig {
  monitorIntervalMs: number;
  parseIntervalMs: number;
  summarizeIntervalMs: number;
  enableAutoRun: boolean;
}

const defaultConfig: OrchestratorConfig = {
  monitorIntervalMs: 30 * 60 * 1000,
  parseIntervalMs: 4 * 60 * 60 * 1000,
  summarizeIntervalMs: 60 * 60 * 1000,
  enableAutoRun: true,
};

let config = { ...defaultConfig };
let monitorTimer: ReturnType<typeof setTimeout> | null = null;
let parseTimer: ReturnType<typeof setTimeout> | null = null;
let summarizeTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

async function runCycle(): Promise<void> {
  if (isRunning) {
    logger.warn("Orchestrator: cycle already running, skipping");
    return;
  }

  isRunning = true;
  logger.info("Orchestrator: starting cycle");

  try {
    await monitorSources();

    const parseResults = await runParseAgent();
    const hasNewArticles = parseResults.some((r) => r.articlesNew > 0);

    if (hasNewArticles) {
      await runSummarizeAgent();
    } else {
      logger.info("Orchestrator: no new articles, skipping summarization");
    }

    logger.info("Orchestrator: cycle complete", {
      sourcesParsed: parseResults.length,
      newArticles: parseResults.reduce((sum, r) => sum + r.articlesNew, 0),
    });
  } catch (error) {
    logger.error("Orchestrator: cycle failed", { error: String(error) });
  } finally {
    isRunning = false;
  }
}

function scheduleNext(): void {
  if (!config.enableAutoRun) return;

  monitorTimer = setTimeout(async () => {
    await runCycle();
    scheduleNext();
  }, config.monitorIntervalMs);
}

export function startOrchestrator(userConfig?: Partial<OrchestratorConfig>): void {
  if (config.enableAutoRun && isRunning) {
    logger.warn("Orchestrator: already running");
    return;
  }

  config = { ...defaultConfig, ...userConfig };
  logger.info("Orchestrator: starting", {
    monitorInterval: `${config.monitorIntervalMs / 1000}s`,
    parseInterval: `${config.parseIntervalMs / 1000}s`,
    summarizeInterval: `${config.summarizeIntervalMs / 1000}s`,
  });

  if (config.enableAutoRun) {
    scheduleNext();
  }
}

export function stopOrchestrator(): void {
  if (monitorTimer) clearTimeout(monitorTimer);
  if (parseTimer) clearTimeout(parseTimer);
  if (summarizeTimer) clearTimeout(summarizeTimer);
  monitorTimer = null;
  parseTimer = null;
  summarizeTimer = null;
  logger.info("Orchestrator: stopped");
}

export async function manualRun(): Promise<{
  parseResults: Awaited<ReturnType<typeof runParseAgent>>;
  summarizeResult: Awaited<ReturnType<typeof runSummarizeAgent>>;
}> {
  logger.info("Orchestrator: manual run triggered");
  await monitorSources();
  const parseResults = await runParseAgent();
  const summarizeResult = await runSummarizeAgent();
  return { parseResults, summarizeResult };
}

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

export function getOrchestratorStatus(): {
  running: boolean;
  agents: { id: string; status: string; lastRun: Date | null }[];
} {
  return {
    running: isRunning,
    agents: [
      getAgentState("parse-agent"),
      getAgentState("summarize-agent"),
    ].map((s) => ({
      id: s.id,
      status: s.status,
      lastRun: s.lastRun,
    })),
  };
}
