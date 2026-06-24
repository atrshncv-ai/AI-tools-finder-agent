import { nanoid } from "nanoid";
import { getDb } from "../queries/connection";
import { pipelineState } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runParseAgent } from "./parseAgent";
import { runSummarizeAgent } from "./summarizeAgent";
import { runTranslateAgent } from "./translateAgent";
import { runDeployAgent } from "./deployAgent";

export type PipelineStage =
  | "idle"
  | "parsing"
  | "summarizing"
  | "translating"
  | "deploying"
  | "completed"
  | "failed";

let currentCycleId: string | null = null;
let isRunning = false;

function generateCycleId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `cycle-${ts}-${nanoid(6)}`;
}

async function savePipelineState(
  cycleId: string,
  stage: PipelineStage,
  totalArticles: number,
  processedArticles: number,
  startedAt?: Date,
  completedAt?: Date,
  errorMessage?: string
): Promise<void> {
  const db = getDb();

  const existing = await db
    .select()
    .from(pipelineState)
    .where(eq(pipelineState.cycleId, cycleId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(pipelineState)
      .set({
        stage,
        totalArticles,
        processedArticles,
        ...(startedAt ? { startedAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      })
      .where(eq(pipelineState.cycleId, cycleId));
  } else {
    await db.insert(pipelineState).values({
      cycleId,
      stage,
      totalArticles,
      processedArticles,
      startedAt: startedAt || new Date(),
      completedAt,
      errorMessage,
    });
  }
}

export async function runPipeline(): Promise<{
  cycleId: string;
  stage: PipelineStage;
  articlesProcessed: number;
  error?: string;
}> {
  if (isRunning) {
    logger.warn("Pipeline: already running, skipping");
    return { cycleId: "skipped", stage: "idle", articlesProcessed: 0 };
  }

  isRunning = true;
  const cycleId = generateCycleId();
  currentCycleId = cycleId;

  logger.info("Pipeline: starting cycle", { cycleId });

  try {
    // Stage 1: Parsing
    await savePipelineState(cycleId, "parsing", 0, 0, new Date());
    logger.info("Pipeline: stage 1/4 - parsing", { cycleId });

    const parseResults = await runParseAgent();
    const totalNew = parseResults.reduce((sum, r) => sum + r.articlesNew, 0);

    if (totalNew === 0) {
      logger.info("Pipeline: no new articles, completing", { cycleId });
      await savePipelineState(
        cycleId,
        "completed",
        0,
        0,
        undefined,
        new Date()
      );
      isRunning = false;
      return { cycleId, stage: "completed", articlesProcessed: 0 };
    }

    await savePipelineState(cycleId, "parsing", totalNew, totalNew);
    logger.info("Pipeline: parsing complete", { cycleId, newArticles: totalNew });

    // Stage 2: Summarization
    await savePipelineState(cycleId, "summarizing", totalNew, 0, new Date());
    logger.info("Pipeline: stage 2/4 - summarizing", { cycleId, count: totalNew });

    const summarizeResult = await runSummarizeAgent();
    await savePipelineState(
      cycleId,
      "summarizing",
      totalNew,
      summarizeResult.summarized
    );
    logger.info("Pipeline: summarizing complete", {
      cycleId,
      summarized: summarizeResult.summarized,
    });

    // Stage 3: Translation
    await savePipelineState(cycleId, "translating", totalNew, 0, new Date());
    logger.info("Pipeline: stage 3/4 - translating", { cycleId, count: totalNew });

    const translateResult = await runTranslateAgent();
    await savePipelineState(
      cycleId,
      "translating",
      totalNew,
      translateResult.translated
    );
    logger.info("Pipeline: translating complete", {
      cycleId,
      translated: translateResult.translated,
    });

    // Stage 4: Deploy
    await savePipelineState(cycleId, "deploying", totalNew, 0, new Date());
    logger.info("Pipeline: stage 4/4 - deploying", { cycleId, count: totalNew });

    const deployResult = await runDeployAgent();
    await savePipelineState(
      cycleId,
      "deploying",
      totalNew,
      deployResult.deployed
    );
    logger.info("Pipeline: deploy complete", {
      cycleId,
      deployed: deployResult.deployed,
    });

    // Pipeline complete
    await savePipelineState(
      cycleId,
      "completed",
      totalNew,
      totalNew,
      undefined,
      new Date()
    );
    logger.info("Pipeline: cycle complete", {
      cycleId,
      totalArticles: totalNew,
    });

    isRunning = false;
    return { cycleId, stage: "completed", articlesProcessed: totalNew };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("Pipeline: cycle failed", { cycleId, error: msg });
    await savePipelineState(
      cycleId,
      "failed",
      0,
      0,
      undefined,
      undefined,
      msg
    );
    isRunning = false;
    return { cycleId, stage: "failed", articlesProcessed: 0, error: msg };
  }
}

export function getPipelineStatus(): {
  running: boolean;
  currentCycleId: string | null;
  lastCycle: {
    cycleId: string;
    stage: string;
    totalArticles: number;
    processedArticles: number;
    startedAt: Date | null;
    completedAt: Date | null;
    errorMessage: string | null;
  } | null;
} {
  return {
    running: isRunning,
    currentCycleId,
    lastCycle: null,
  };
}

export async function getLastPipelineCycle(): Promise<{
  cycleId: string;
  stage: string;
  totalArticles: number;
  processedArticles: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
} | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(pipelineState)
    .orderBy(desc(pipelineState.createdAt))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    cycleId: row.cycleId,
    stage: row.stage,
    totalArticles: row.totalArticles,
    processedArticles: row.processedArticles,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    errorMessage: row.errorMessage,
  };
}
