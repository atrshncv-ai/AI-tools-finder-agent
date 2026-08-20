#!/usr/bin/env tsx
/**
 * backfill-classification.ts — Re-run current classification rules over
 * existing rows so old entries obey the same strict AI-signal +
 * science-domain logic that collect-dual.ts applies to fresh items.
 *
 * Motivation (2026-08-20): dashboard and digest showed non-AI Nature news
 * (orcas, Fields medals, visa rules, obituaries) inside "ИИ для науки" and
 * "Инструменты для изобретений". Those rows were classified by legacy rules.
 *
 * What it does:
 *   1. Loads rows in the given section(s) (default: science + invention-tools).
 *   2. Re-runs classifyArticle + classifyInvention with CURRENT rules.
 *   3. If the section assignment changed, updates the row and logs the move.
 *
 * Safety:
 *   - --dry-run — only print what would change, no writes.
 *   - Only touches the `section` column — never title/summary/status/urls.
 *
 * Usage:
 *   npx tsx scripts/hermes/backfill-classification.ts [--dry-run]
 *   BACKFILL_SECTIONS="science,invention-tools" (env, default same)
 */
import "dotenv/config";

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import { classifyArticle } from "../../api/lib/classify";
import { classifyInvention, buildInventionContext } from "../../api/lib/invention-classify";

const dryRun = process.argv.includes("--dry-run");
const scopes = (process.env.BACKFILL_SECTIONS || "science,invention-tools")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const db = getDb();

async function main() {
  const rows = await db
    .select({ id: news.id, section: news.section, title: news.title, summary: news.summary })
    .from(news)
    .where(inArray(news.section, scopes));

  let moved = 0;
  for (const row of rows) {
    const classification = classifyArticle(row.title, row.summary ?? "");
    const invention = classifyInvention(buildInventionContext(row.title, row.summary ?? ""));

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

  console.log(`scanned=${rows.length} moved=${moved} dryRun=${dryRun}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
