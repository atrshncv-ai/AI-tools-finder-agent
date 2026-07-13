#!/usr/bin/env tsx
/**
 * translate-title.ts — Translates an article title to Russian via Zen API and saves it.
 *
 * Usage:
 *   npx tsx scripts/hermes/translate-title.ts --id <article_id> --title <translated_title>
 *
 * Updates the news record: sets the translated title, copies content to translation field,
 * and sets status='translated'. For Russian articles, pass the original title.
 * Exits with code 0 on success, 1 on error.
 */

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";

interface Args {
  id: number | null;
  title: string | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { id: null, title: null };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--id":
        result.id = parseInt(args[++i] || "", 10);
        break;
      case "--title":
        result.title = args[++i] || null;
        break;
    }
  }

  return result;
}

function validateArgs(args: Args): string[] {
  const errors: string[] = [];
  if (!args.id || isNaN(args.id)) errors.push("--id is required and must be a number");
  if (!args.title) errors.push("--title is required");
  return errors;
}

async function main() {
  const args = parseArgs();
  const errors = validateArgs(args);

  if (errors.length > 0) {
    console.error("[translate-title] Validation errors:");
    errors.forEach((e) => console.error(`  - ${e}`));
    console.error("\nUsage: npx tsx scripts/hermes/translate-title.ts --id <n> --title <translated>");
    process.exit(1);
  }

  console.log(`[translate-title] Translating title for article #${args.id}...`);

  const db = getDb();

  const article = await db.query.news.findFirst({
    where: eq(news.id, args.id!),
  });

  if (!article) {
    console.error(`[translate-title] Article #${args.id} not found`);
    process.exit(1);
  }

  // For Russian articles, use original content as translation
  const translation = article.language === "ru"
    ? (article.originalContent || article.content || article.summary)
    : (article.content || article.summary);

  await db
    .update(news)
    .set({
      title: args.title!,
      translation,
      status: "translated",
      updatedAt: new Date(),
    })
    .where(eq(news.id, args.id!));

  console.log(`[translate-title] Article #${args.id} updated: status → translated`);
  console.log(`[translate-title] New title: ${args.title!.substring(0, 80)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[translate-title] Fatal error:", err);
  process.exit(1);
});
