#!/usr/bin/env tsx
/**
 * translate-title.ts — Translate an article title via Zen API and save to DB.
 *
 * Usage (auto mode — full pipeline):
 *   npx tsx scripts/hermes/translate-title.ts --id <article_id> [--model <name>]
 *
 * Usage (manual mode — pass pre-computed result):
 *   npx tsx scripts/hermes/translate-title.ts --id <article_id> --title <translated_title>
 *
 * Auto mode: reads article from DB, calls Zen API for translation, saves result.
 * Manual mode: saves the provided translated title directly.
 * For Russian articles, auto mode skips Zen and uses original content as translation.
 * Exits with code 0 on success, 1 on error.
 */

import { getDb } from "../../api/queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";
import { translateTitle as zenTranslateTitle, checkZenConnection } from "../../api/ai/zenClient";

// ─── Args parsing ────────────────────────────────────────────────────────────

interface Args {
  id: number | null;
  title: string | null;
  model: string | null;
  auto: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = { id: null, title: null, model: null, auto: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--id":
        result.id = parseInt(args[++i] || "", 10);
        break;
      case "--title":
        result.title = args[++i] || null;
        break;
      case "--model":
        result.model = args[++i] || null;
        break;
      case "--auto":
        result.auto = true;
        break;
    }
  }

  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (!args.id || isNaN(args.id)) {
    console.error("[translate-title] --id is required and must be a number");
    console.error("\nUsage:");
    console.error("  npx tsx scripts/hermes/translate-title.ts --id <article_id> [--model <name>]");
    console.error("  npx tsx scripts/hermes/translate-title.ts --id <n> --title <translated>");
    process.exit(1);
  }

  const db = getDb();
  const article = await db.query.news.findFirst({
    where: eq(news.id, args.id!),
  });

  if (!article) {
    console.error(`[translate-title] Article #${args.id} not found`);
    process.exit(1);
  }

  let translatedTitle: string;
  let translation: string;

  if (args.auto) {
    // ── Auto mode: translate via Zen or skip for Russian ──
    console.error(`[translate-title] Auto mode: translating article #${args.id}...`);
    console.error(`[translate-title] Original title: ${article.title.substring(0, 80)}`);

    if (article.language === "ru") {
      // Russian article — no translation needed
      translatedTitle = article.title;
      translation = article.originalContent || article.content || article.summary;
      console.error("[translate-title] Russian article, skipping Zen API call");
    } else {
      // Non-Russian — call Zen API
      const zenOk = await checkZenConnection();
      if (!zenOk) {
        console.error("[translate-title] Zen API is not available");
        process.exit(1);
      }

      const result = await zenTranslateTitle(article.title);
      translatedTitle = result.trim();
      if (translatedTitle.length < 3) {
        console.warn("[translate-title] Title translation returned empty, keeping original");
        translatedTitle = article.title;
      }
      translation = article.content || article.summary;
      console.error(`[translate-title] Translated: ${translatedTitle.substring(0, 80)}`);
    }
  } else {
    // ── Manual mode: use provided args ──
    if (!args.title) {
      console.error("[translate-title] --title is required (or use --auto)");
      process.exit(1);
    }
    translatedTitle = args.title;
    translation = article.language === "ru"
      ? (article.originalContent || article.content || article.summary)
      : (article.content || article.summary);
  }

  // Save to DB
  await db
    .update(news)
    .set({
      title: translatedTitle,
      translation,
      status: "translated",
      updatedAt: new Date(),
    })
    .where(eq(news.id, args.id!));

  console.log(JSON.stringify({
    status: "ok",
    articleId: args.id,
    translatedTitle: translatedTitle.substring(0, 100),
    translationLength: translation?.length || 0,
  }));

  process.exit(0);
}

main().catch((err) => {
  console.error("[translate-title] Fatal error:", err);
  process.exit(1);
});
