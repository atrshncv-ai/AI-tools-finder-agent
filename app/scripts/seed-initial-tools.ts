#!/usr/bin/env tsx
/**
 * seed-initial-tools.ts — one-off seed of elite hand-curated AI tools.
 *
 * Reads seed_data.md (JSON array) from the project root and inserts all
 * records directly into `news` as published dashboard content.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../api/queries/connection";
import { news } from "@db/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SeedItem {
  title: string;
  summary: string;
  original_url: string;
}

/** Only absolute http(s) URLs may enter the DB (format + SSRF guard). */
function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function loadSeedData(): SeedItem[] {
  const filePath = path.resolve(__dirname, "../../seed_data.md");
  const raw = fs.readFileSync(filePath, "utf8").trim();
  return JSON.parse(raw) as SeedItem[];
}

/**
 * Historical publication dates: random 1-14 days ago per item. Seeding with
 * dates clustered at "now" makes every dashboard card look freshly
 * published (the "1 min ago" UX bug) — a real archive spans weeks.
 */
function distributeDates(count: number): Date[] {
  const now = Date.now();
  return Array.from({ length: count }, () => {
    const msAgo = (1 + Math.random() * 13) * 24 * 3600_000; // 1..14 days ago
    return new Date(now - msAgo);
  });
}

async function main() {
  const loaded = loadSeedData();
  if (!Array.isArray(loaded) || loaded.length === 0) {
    throw new Error("seed_data.md is empty or not a JSON array");
  }

  // Validate before insert: drop entries with missing fields or non-http(s) URLs.
  const items = loaded.filter((it) => {
    const ok = Boolean(it?.title && it?.summary) && isValidHttpUrl(it?.original_url ?? "");
    if (!ok) {
      console.warn(`[seed-initial-tools] skipping invalid entry: ${it?.title ?? "<no title>"} -> ${it?.original_url}`);
    }
    return ok;
  });
  if (items.length === 0) throw new Error("seed_data.md: no valid entries after URL validation");

  const dates = distributeDates(items.length);
  const rows = items.map((item, i) => ({
    title: item.title,
    summary: item.summary,
    originalUrl: item.original_url,
    content: null,
    status: "published" as const,
    isScience: false,
    scienceField: null,
    score: 95,
    source: "seed-data",
    language: "ru",
    publishedAt: dates[i],
    metrics: { origin: "seed-data" },
  }));

  const db = getDb();
  const result = await db
    .insert(news)
    .values(rows)
    .onConflictDoNothing({ target: news.originalUrl })
    .returning({ id: news.id, title: news.title });

  const inserted = result.length;
  const skipped = items.length - inserted;

  console.log(
    JSON.stringify(
      {
        status: "ok",
        total: items.length,
        inserted,
        skipped,
        firstId: result[0]?.id ?? null,
        lastId: result[result.length - 1]?.id ?? null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-initial-tools] Failed:", err);
  process.exit(1);
});
