#!/usr/bin/env tsx
/**
 * run-yesterday-test.ts — Controlled backfill test run (one-off).
 *
 * Runs the FULL pipeline over a strict "yesterday" window (-48h..-24h):
 *   1. collect-dual.ts  (--min-age-hours 24 --max-age-hours 48)
 *   2. evaluate-news.ts (--id <each inserted>, daily cap bypassed on purpose)
 *   3. save-summary.ts  (--auto: yt-dlp transcript / HTML fetch + Zen summary)
 *   4. Publishes approved cards tagged with a "[TEST-YESTERDAY] " title
 *      prefix and a 'test-yesterday' tag so they are visually separable
 *      on the dashboard.
 *
 * Prints aggregate analytics to stdout at the end.
 *
 * Usage:
 *   npx tsx scripts/run-yesterday-test.ts
 */

import "dotenv/config";
import { execFile } from "node:child_process";
import { getDb } from "../api/queries/connection";
import { news } from "@db/schema";
import { eq, inArray, and, or, isNull, gte, lte, sql } from "drizzle-orm";

const MIN_AGE_HOURS = 24;
const MAX_AGE_HOURS = 48;
const TITLE_PREFIX = "[TEST-YESTERDAY] ";
const TEST_TAG = "test-yesterday";
const SCRIPT_TIMEOUT_MS = 5 * 60_000; // per pipeline step (yt-dlp + Zen can be slow)

interface StepResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runStep(script: string, args: string[]): Promise<StepResult> {
  return new Promise((resolve) => {
    execFile(
      "npx",
      ["tsx", script, ...args],
      { timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err && typeof err.code === "number" ? err.code : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** Last JSON object printed to stdout (pipeline scripts log JSON on one line). */
function parseJsonLine<T>(stdout: string): T | null {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as T;
    } catch {
      // try next line up
    }
  }
  return null;
}

function appendTag(existing: string | null, tag: string): string {
  const parts = (existing ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!parts.includes(tag)) parts.push(tag);
  return parts.join(",");
}

async function main() {
  console.error(`[run-yesterday-test] Window: ${MIN_AGE_HOURS}h..${MAX_AGE_HOURS}h ago (strictly yesterday)`);

  // ── Step 1: collect ──
  console.error("\n[step 1/4] collect-dual...");
  const collect = await runStep("scripts/hermes/collect-dual.ts", [
    "--stream", "both",
    "--min-age-hours", String(MIN_AGE_HOURS),
    "--max-age-hours", String(MAX_AGE_HOURS),
  ]);
  const collectStats = parseJsonLine<{
    raw: number;
    fresh: number;
    inserted: number;
    duplicates: number;
    errors: number;
    insertedIds: number[];
  }>(collect.stdout);
  if (!collectStats) {
    console.error("[run-yesterday-test] FATAL: collect-dual produced no stats JSON");
    console.error(collect.stderr.slice(-2000));
    process.exit(1);
  }
  const insertedIds = collectStats.insertedIds ?? [];
  console.error(
    `[step 1/4] raw=${collectStats.raw}, in-window=${collectStats.fresh}, ` +
      `inserted=${collectStats.inserted}, duplicates=${collectStats.duplicates}, errors=${collectStats.errors}`,
  );

  // ── Step 1b: recover in-window rows the daily cap or scheduler missed ──
  // A backfill day is usually already collected by the loop (dedup blocks
  // re-insertion), so the interesting test population lives in the DB:
  //   - rejected ONLY because of the daily cap (they legitimately passed the gate)
  //   - still pending without a score (never evaluated)
  const db = getDb();
  const windowStart = new Date(Date.now() - MAX_AGE_HOURS * 3600_000);
  const windowEnd = new Date(Date.now() - MIN_AGE_HOURS * 3600_000);
  const recoverable = await db
    .select({ id: news.id })
    .from(news)
    .where(
      and(
        gte(news.publishedAt, windowStart),
        lte(news.publishedAt, windowEnd),
        or(
          and(
            eq(news.status, "rejected"),
            sql`${news.metrics}->>'decision' = 'rejected-daily-cap'`,
          ),
          and(eq(news.status, "pending"), isNull(news.score)),
        ),
      ),
    );
  const recoverIds = recoverable.map((r) => r.id).filter((id) => !insertedIds.includes(id));
  console.error(`[step 1b/4] recoverable in-window DB rows (daily-cap / unevaluated): ${recoverIds.length}`);

  // ── Step 2: evaluate each candidate (daily cap intentionally bypassed) ──
  const candidateIds = [...insertedIds, ...recoverIds];
  console.error(`\n[step 2/4] evaluate-news for ${candidateIds.length} candidates (daily cap OFF)...`);
  const approvedIds: number[] = [];
  let rejectedByFilter = 0;
  for (const id of candidateIds) {
    const ev = await runStep("scripts/hermes/evaluate-news.ts", ["--id", String(id), "--daily-cap", "1"]);
    const evStats = parseJsonLine<{ approved: number; rejected: number }>(ev.stdout);
    if (evStats && evStats.approved > 0) {
      approvedIds.push(id);
      console.error(`  #${id}: APPROVED`);
    } else {
      rejectedByFilter++;
      console.error(`  #${id}: rejected (score below gate)`);
    }
  }

  // ── Step 3: summarize + publish with test tagging ──
  console.error(`\n[step 3/4] save-summary + publish for ${approvedIds.length} approved...`);
  const publishedIds: number[] = [];
  let summaryFailed = 0;
  for (const id of approvedIds) {
    const sm = await runStep("scripts/hermes/save-summary.ts", ["--id", String(id), "--auto"]);
    const smStats = parseJsonLine<{ status: string; titleRu?: string }>(sm.stdout);
    if (!smStats || smStats.status !== "ok") {
      summaryFailed++;
      console.error(`  #${id}: summary FAILED (${smStats ? smStats.status : sm.stderr.slice(-120)})`);
      continue;
    }
    const row = await db.query.news.findFirst({ where: eq(news.id, id) });
    if (!row) continue;
    const taggedTitle = row.title.startsWith(TITLE_PREFIX) ? row.title : TITLE_PREFIX + row.title;
    await db
      .update(news)
      .set({
        title: taggedTitle,
        tags: appendTag(row.tags, TEST_TAG),
        status: "published",
        updatedAt: new Date(),
      })
      .where(eq(news.id, id));
    publishedIds.push(id);
    console.error(`  #${id}: PUBLISHED "${taggedTitle.slice(0, 70)}"`);
  }

  // ── Step 4: analytics ──
  let textCount = 0;
  let videoCount = 0;
  if (publishedIds.length > 0) {
    const rows = await db
      .select({ id: news.id, source: news.source })
      .from(news)
      .where(inArray(news.id, publishedIds));
    for (const r of rows) {
      if (r.source?.startsWith("youtube-")) videoCount++;
      else textCount++;
    }
  }

  const report = {
    window: { minAgeHours: MIN_AGE_HOURS, maxAgeHours: MAX_AGE_HOURS },
    rawCandidates: collectStats.raw,
    inWindowCandidates: collectStats.fresh,
    duplicatesSkipped: collectStats.duplicates,
    inserted: collectStats.inserted,
    recoveredFromDb: recoverIds.length,
    rejectedByFilter,
    approved: approvedIds.length,
    summaryFailed,
    published: publishedIds.length,
    publishedText: textCount,
    publishedVideo: videoCount,
    publishedIds,
  };
  console.log(JSON.stringify(report, null, 2));

  console.error("\n════════ BACKFILL REPORT (yesterday window) ════════");
  console.error(`📥 Raw candidates:        ${report.inWindowCandidates} (of ${report.rawCandidates} total scraped)`);
  console.error(`🔁 Duplicates skipped:    ${report.duplicatesSkipped}`);
  console.error(`♻️  Recovered from DB:     ${report.recoveredFromDb} (daily-cap / unevaluated)`);
  console.error(`🗑 Rejected by filter:    ${report.rejectedByFilter} (score <= 65)`);
  console.error(`⚠️  Summary failed:        ${report.summaryFailed}`);
  console.error(`✅ Published:             ${report.published}  (text: ${textCount}, video: ${videoCount})`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[run-yesterday-test] Fatal error:", err);
  process.exit(1);
});
