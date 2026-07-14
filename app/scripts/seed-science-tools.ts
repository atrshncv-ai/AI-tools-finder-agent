#!/usr/bin/env tsx
/**
 * seed-science-tools.ts — one-off seed of elite hand-curated science AI tools.
 *
 * Reads science_seed_data.md (or seed_data_science.md fallback) from the project
 * root and inserts all records directly into `news` as published science content.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../api/queries/connection";
import { news, categories } from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import { onConflictDoNothing } from "drizzle-orm/pg-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SeedItem {
  title: string;
  summary: string;
  original_url: string;
  category_slug: string;
}

const SCIENCE_CATEGORIES = [
  { name: "Химия", slug: "chemistry", type: "science" },
  { name: "Материаловедение", slug: "materials", type: "science" },
  { name: "Биология", slug: "biology", type: "science" },
  { name: "Медицина", slug: "medicine", type: "science" },
  { name: "Физика", slug: "physics", type: "science" },
  { name: "Инженерия", slug: "engineering", type: "science" },
];

function loadSeedData(): SeedItem[] {
  const candidates = ["science_seed_data.md", "seed_data_science.md"];
  for (const name of candidates) {
    const filePath = path.resolve(__dirname, "../../", name);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8").trim();
      return JSON.parse(raw) as SeedItem[];
    }
  }
  throw new Error("Science seed file not found: tried science_seed_data.md, seed_data_science.md");
}

function distributeDates(count: number): Date[] {
  const now = Date.now();
  const windowMs = 48 * 3600_000;
  const start = now - windowMs;
  if (count <= 1) return [new Date(now)];
  const step = windowMs / (count - 1);
  return Array.from({ length: count }, (_, i) => new Date(start + i * step));
}

async function main() {
  const items = loadSeedData();
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Science seed data is empty or not a JSON array");
  }

  const db = getDb();

  // Ensure science categories exist.
  for (const cat of SCIENCE_CATEGORIES) {
    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, cat.slug))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(categories).values(cat);
    }
  }

  // Build slug -> category map.
  const slugs = items.map((i) => i.category_slug);
  const catRows = await db.select().from(categories).where(inArray(categories.slug, slugs));
  const catBySlug = new Map(catRows.map((c) => [c.slug, c]));

  const dates = distributeDates(items.length);
  const rows = items.map((item, i) => {
    const cat = catBySlug.get(item.category_slug);
    if (!cat) {
      throw new Error(`Unknown category_slug: ${item.category_slug}`);
    }
    return {
      title: item.title,
      summary: item.summary,
      originalUrl: item.original_url,
      content: null,
      status: "published" as const,
      isScience: true,
      scienceField: cat.name,
      score: 95,
      source: "science-seed",
      language: "ru",
      publishedAt: dates[i],
      categoryId: cat.id,
      categorySlug: cat.slug,
      metrics: { origin: "science-seed" },
    };
  });

  const result = await db
    .insert(news)
    .values(rows)
    .onConflictDoNothing({ target: news.originalUrl })
    .returning({ id: news.id, title: news.title, categorySlug: news.categorySlug });

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
  console.error("[seed-science-tools] Failed:", err);
  process.exit(1);
});
