import { getDb } from "../queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";
import { getAgentState, updateAgentState } from "./state";
import { logger } from "../lib/logger";

const BATCH_SIZE = 50;

export async function runDeployAgent(): Promise<{
  deployed: number;
  errors: string[];
}> {
  const state = getAgentState("deploy-agent");

  if (state.status === "running") {
    logger.warn("Deploy Agent: already running, skipping");
    return { deployed: 0, errors: [] };
  }

  updateAgentState("deploy-agent", {
    status: "running",
    lastRun: new Date(),
    runCount: state.runCount + 1,
  });

  const errors: string[] = [];
  let deployed = 0;

  try {
    const db = getDb();
    const ready = await db
      .select()
      .from(news)
      .where(eq(news.status, "translated"))
      .limit(BATCH_SIZE);

    if (ready.length === 0) {
      logger.info("Deploy Agent: no articles to deploy");
      updateAgentState("deploy-agent", { status: "idle" });
      return { deployed: 0, errors: [] };
    }

    logger.info("Deploy Agent: found articles", { count: ready.length });

    for (const article of ready) {
      try {
        await db
          .update(news)
          .set({
            status: "published",
            updatedAt: new Date(),
          })
          .where(eq(news.id, article.id));

        deployed++;

        logger.info("Deploy Agent: article deployed", {
          id: article.id,
          title: article.title.substring(0, 50),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Article ${article.id}: ${msg}`);
        logger.error("Deploy Agent: article failed", {
          id: article.id,
          error: msg,
        });
      }
    }

    updateAgentState("deploy-agent", {
      status: "idle",
      successCount: state.successCount + deployed,
    });

    logger.info("Deploy Agent: batch complete", { deployed, errors: errors.length });
  } catch (error) {
    updateAgentState("deploy-agent", {
      status: "error",
      lastError: error instanceof Error ? error.message : String(error),
    });
    logger.error("Deploy Agent: fatal error", { error: String(error) });
  }

  return { deployed, errors };
}
