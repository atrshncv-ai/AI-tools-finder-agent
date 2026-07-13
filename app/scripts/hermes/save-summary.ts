#!/usr/bin/env tsx
/**
 * save-summary.ts — Saves a generated summary back to the database.
 *
 * Usage:
 *   npx tsx scripts/hermes/save-summary.ts --id <article_id> --summary <text> --content <text> [--model <name>]
 *
 * Updates the news record: sets summary, content (detailed), status='summarized',
 * and optionally modelUsed. Exits with code 0 on success, 1 on error.
 */

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";

interface Args {
  id: number | null;
  summary: string | null;
  content: string | null;
  model: string | null;
  originalContent: string | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    id: null,
    summary: null,
    content: null,
    model: null,
    originalContent: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--id":
        result.id = parseInt(args[++i] || "", 10);
        break;
      case "--summary":
        result.summary = args[++i] || null;
        break;
      case "--content":
        result.content = args[++i] || null;
        break;
      case "--model":
        result.model = args[++i] || null;
        break;
      case "--original-content":
        result.originalContent = args[++i] || null;
        break;
    }
  }

  return result;
}

function validateArgs(args: Args): string[] {
  const errors: string[] = [];
  if (!args.id || isNaN(args.id)) errors.push("--id is required and must be a number");
  if (!args.summary) errors.push("--summary is required");
  if (!args.content) errors.push("--content is required");
  return errors;
}

async function main() {
  const args = parseArgs();
  const errors = validateArgs(args);

  if (errors.length > 0) {
    console.error("[save-summary] Validation errors:");
    errors.forEach((e) => console.error(`  - ${e}`));
    console.error("\nUsage: npx tsx scripts/hermes/save-summary.ts --id <n> --summary <text> --content <text> [--model <name>]");
    process.exit(1);
  }

  console.log(`[save-summary] Saving summary for article #${args.id}...`);

  const db = getDb();

  // Verify article exists
  const article = await db.query.news.findFirst({
    where: eq(news.id, args.id!),
  });

  if (!article) {
    console.error(`[save-summary] Article #${args.id} not found`);
    process.exit(1);
  }

  const updateData: Record<string, unknown> = {
    summary: args.summary,
    content: args.content,
    status: "summarized",
    updatedAt: new Date(),
  };

  if (args.model) {
    updateData.modelUsed = args.model;
  }

  if (args.originalContent) {
    updateData.originalContent = args.originalContent;
  }

  await db.update(news).set(updateData).where(eq(news.id, args.id!));

  console.log(`[save-summary] Article #${args.id} updated: status → summarized`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[save-summary] Fatal error:", err);
  process.exit(1);
});
