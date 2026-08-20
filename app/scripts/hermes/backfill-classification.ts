#!/usr/bin/env tsx
/**
 * backfill-classification.ts — Re-run CURRENT classification rules over
 * existing rows and REJECT rows that fail the strict AI-signal gate.
 *
 * Background (2026-08-20): the dashboard and digest showed non-AI Nature
 * news (orcas, Fields medals, visa rules, obituaries) inside "ИИ-новости",
 * "ИИ для науки" and "Инструменты для изобретений". Those rows were
 * classified by legacy rules before the strict classifier existed.
 *
 * The previous hotfix script moved such rows between sections (science →
 * ai-news), which kept the junk visible — this script instead demotes
 * anything without an explicit AI/ML signal to status='rejected'.
 *
 * Rules (mirror collect-dual.ts section assignment):
 *   1. No explicit AI/ML signal in title+summary  -> status='rejected'
 *   2. classifyInvention match                    -> section='invention-tools'
 *   3. classifyArticle.isScience                  -> section='science'
 *   4. otherwise (AI signal, no science domain)   -> section='ai-news'
 *
 * Safety:
 *   - --dry-run — print the plan, write nothing.
 *   - Only touches section/status — never title/summary/urls/updatedAt.
 *   - Scoped to BACKFILL_SECTIONS (default: science,invention-tools,ai-news)
 *     and BACKFILL_STATUS (default: published,pending,summarized).
 *
 * Usage:
 *   npx tsx scripts/hermes/backfill-classification.ts [--dry-run]
 */
import "dotenv/config";

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { classifyArticle, hasExplicitAiSignal } from "../../api/lib/classify";
import { classifyInvention, buildInventionContext } from "../../api/lib/invention-classify";

const dryRun = process.argv.includes("--dry-run");
const scopes = (process.env.BACKFILL_SECTIONS || "science,invention-tools,ai-news")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const statuses = (process.env.BACKFILL_STATUS || "published,pending,summarized")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const db = getDb();

async function main() {
  const rows = await db
    .select({
      id: news.id,
      section: news.section,
      status: news.status,
      title: news.title,
      summary: news.summary,
    })
    .from(news)
    .where(and(inArray(news.section, scopes), inArray(news.status, statuses)));

  let moved = 0;
  let rejected = 0;
  for (const row of rows) {
    const text = buildInventionContext(row.title, null, row.summary);

    // 1. Strict gate: no AI/ML signal -> reject (junk must not surface).
    if (!hasExplicitAiSignal(text)) {
      if (row.status !== "rejected") {
        rejected++;
        console.log(`${row.id} [${row.section}/${row.status} -> rejected] ${row.title.slice(0, 60)}`);
        if (!dryRun) {
          await db.update(news).set({ status: "rejected" }).where(eq(news.id, row.id));
        }
      }
      continue;
    }

    // 2-4. Re-assign the section with current rules.
    const classification = classifyArticle(row.title, row.summary ?? "");
    const invention = classifyInvention(text);

    const newSection = invention.isInvention
      ? "invention-tools"
      : classification.isScience
        ? "science"
        : "ai-news";

    if (newSection === row.section) continue;

    moved++;
    console.log(`${row.id} [${row.section} -> ${newSection}] ${row.title.slice(0, 60)}`);
    if (!dryRun) {
      await db.update(news).set({ section: newSection }).where(eq(news.id, row.id));
    }
  }

  console.log(`scan=${rows.length} moved=${moved} rejected=${rejected} dryRun=${dryRun}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});