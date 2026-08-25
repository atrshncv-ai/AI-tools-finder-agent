#!/usr/bin/env tsx
/**
 * backfill-sections.ts — Reclassify existing news rows with the unified
 * three-way resolver (section-resolve.ts).
 *
 * Fixes cards filed into the wrong section by the pre-2026-08-25 classifiers
 * (client feedback: medical/general-science items inside invention-tools,
 * empty science section) WITHOUT deleting anything or inventing data.
 *
 * Dry-run by default: prints transition counters and up to 20 examples.
 * `--apply` writes section/sphereTags/isScience/scienceField. updatedAt and
 * platformPublishedAt are intentionally NOT touched so freshness windows and
 * digest selection stay stable.
 *
 * Usage:
 *   npx tsx scripts/hermes/backfill-sections.ts            # dry-run
 *   npx tsx scripts/hermes/backfill-sections.ts --apply
 */

import "dotenv/config";
import { pathToFileURL } from "url";
import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import { resolveSection } from "../../api/lib/section-resolve";

interface Row {
  id: number;
  title: string;
  originalTitle: string | null;
  summary: string;
  originalContent: string | null;
  content: string | null;
  section: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();

  const rows: Row[] = await db
    .select({
      id: news.id,
      title: news.title,
      originalTitle: news.originalTitle,
      summary: news.summary,
      originalContent: news.originalContent,
      content: news.content,
      section: news.section,
    })
    .from(news)
    .where(inArray(news.status, ["published", "summarized", "pending"]));

  console.error(`[backfill-sections] Scanning ${rows.length} rows (${apply ? "APPLY" : "DRY-RUN"})...`);

  const transitions = new Map<string, number>();
  const examples: string[] = [];
  let changed = 0;

  for (const row of rows) {
    // Compare against the untranslated title when present: `title` may already
    // be the Russian rendering produced at summary time.
    const resolution = resolveSection({
      title: (row.originalTitle || row.title || "").trim(),
      description: (row.summary || "").trim(),
      content: (row.originalContent || row.content || "").trim(),
    });
    if (resolution.section === row.section) continue;

    changed++;
    const key = `${row.section} -> ${resolution.section}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    if (examples.length < 20) {
      examples.push(`#${row.id} [${row.section} -> ${resolution.section}] ${(row.originalTitle || row.title).slice(0, 70)}`);
    }

    if (!apply) continue;

    await db
      .update(news)
      .set({
        section: resolution.section,
        sphereTags: resolution.sphereTags,
        isScience: resolution.isScience,
        scienceField: resolution.scienceField,
      })
      .where(eq(news.id, row.id));
  }

  console.error("Transitions:");
  for (const [key, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${key}: ${n}`);
  }
  for (const line of examples) console.error(`  ${line}`);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        mode: apply ? "apply" : "dry-run",
        scanned: rows.length,
        changed,
        transitions: Object.fromEntries(transitions),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[backfill-sections] Fatal error:", err);
    process.exit(1);
  });
}
