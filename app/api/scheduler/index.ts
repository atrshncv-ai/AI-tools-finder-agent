import cron from "node-cron";
import { runPipeline, runSciencePipeline } from "../agent/pipeline";
import { logger } from "../lib/logger";

const DAILY_DIGEST_CRON = "0 6 * * *";
const SCIENCE_TOOLS_CRON = "0 7 * * *";
const ADDITIONAL_CRON = "0 */4 * * *";

let dailyDigestTask: cron.ScheduledTask | null = null;
let scienceToolsTask: cron.ScheduledTask | null = null;
let additionalTask: cron.ScheduledTask | null = null;

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

async function runSciencePipelineCycle(): Promise<void> {
  logger.info("Scheduler: science pipeline cycle triggered");
  try {
    const result = await runSciencePipeline();
    logger.info("Scheduler: science pipeline cycle complete", {
      cycleId: result.cycleId,
      stage: result.stage,
      articlesProcessed: result.articlesProcessed,
      error: result.error,
    });
  } catch (error) {
    logger.error("Scheduler: science pipeline cycle failed", { error: String(error) });
  }
}

export function startScheduler() {
  logger.info("Scheduler: starting cron jobs", {
    dailyDigest: DAILY_DIGEST_CRON,
    scienceTools: SCIENCE_TOOLS_CRON,
    additional: ADDITIONAL_CRON,
  });

  dailyDigestTask = cron.schedule(DAILY_DIGEST_CRON, async () => {
    await runPipelineCycle();
  });

  scienceToolsTask = cron.schedule(SCIENCE_TOOLS_CRON, async () => {
    await runSciencePipelineCycle();
  });

  additionalTask = cron.schedule(ADDITIONAL_CRON, async () => {
    await runPipelineCycle();
  });

  logger.info("Scheduler: all cron jobs registered", {
    dailyDigest: "06:00",
    scienceTools: "07:00",
    additional: "every 4 hours",
  });
}

export function stopScheduler() {
  if (dailyDigestTask) dailyDigestTask.stop();
  if (scienceToolsTask) scienceToolsTask.stop();
  if (additionalTask) additionalTask.stop();
  logger.info("Scheduler: stopped");
}

export { runPipelineCycle };
