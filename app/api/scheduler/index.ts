import cron from "node-cron";
import { runPipeline } from "../agent/pipeline";
import { logger } from "../lib/logger";

const PIPELINE_CRON = "0 */4 * * *";

let pipelineTask: cron.ScheduledTask | null = null;

async function runPipelineCycle(): Promise<void> {
  logger.info("Scheduler: pipeline cycle triggered");
  try {
    const result = await runPipeline();
    logger.info("Scheduler: pipeline cycle complete", {
      cycleId: result.cycleId,
      stage: result.stage,
      articlesProcessed: result.articlesProcessed,
      error: result.error,
    });
  } catch (error) {
    logger.error("Scheduler: pipeline cycle failed", { error: String(error) });
  }
}

export function startScheduler() {
  logger.info("Scheduler: starting pipeline cron", { cron: PIPELINE_CRON });

  pipelineTask = cron.schedule(PIPELINE_CRON, async () => {
    await runPipelineCycle();
  });

  logger.info("Scheduler: pipeline registered", {
    nextRun: "every 4 hours (06:00, 10:00, 14:00, 18:00, 22:00, 02:00)",
  });
}

export function stopScheduler() {
  if (pipelineTask) pipelineTask.stop();
  logger.info("Scheduler: stopped");
}

export { runPipelineCycle };
