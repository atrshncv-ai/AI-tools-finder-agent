#!/usr/bin/env tsx
import { eq } from "drizzle-orm";
import { news } from "@db/schema";
import { closeDb, getDb } from "../../api/queries/connection";
import {
  nextFailureState,
  type FailureStage,
  type ProcessingFailures,
} from "./failure-policy";

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const id = Number(valueAfter("--id"));
  const stage = valueAfter("--stage") as FailureStage | null;
  const reason = valueAfter("--reason");
  const isYoutube = process.argv.includes("--youtube");

  if (!Number.isInteger(id) || !stage || !["fetch", "extract", "zen"].includes(stage) || !reason) {
    console.error(
      "Usage: record-processing-failure.ts --id N --stage fetch|extract|zen --reason TEXT [--youtube]",
    );
    process.exit(1);
  }

  const db = getDb();
  const article = await db.query.news.findFirst({ where: eq(news.id, id) });
  if (!article) {
    console.error(`[failure] Article #${id} not found`);
    process.exit(1);
  }

  const metrics = (article.metrics && typeof article.metrics === "object"
    ? article.metrics
    : {}) as Record<string, unknown>;
  const failures = (metrics.processingFailures && typeof metrics.processingFailures === "object"
    ? metrics.processingFailures
    : {}) as ProcessingFailures;
  const state = nextFailureState(failures, stage, reason, isYoutube);
  const now = new Date();

  const updatedFailures: ProcessingFailures = {
    ...failures,
    [stage]: {
      attempts: state.attempts,
      reason,
      lastFailedAt: now.toISOString(),
    },
  };

  await db
    .update(news)
    .set({
      metrics: { ...metrics, processingFailures: updatedFailures },
      ...(state.reject ? { status: "rejected" } : {}),
      updatedAt: now,
    })
    .where(eq(news.id, id));

  console.log(
    JSON.stringify({
      status: state.reject ? "rejected" : "retry",
      articleId: id,
      stage,
      reason,
      attempts: state.attempts,
    }),
  );
  await closeDb();
}

main().catch((error) => {
  console.error("[failure] Fatal error:", error);
  process.exit(1);
});
