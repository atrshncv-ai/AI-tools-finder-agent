#!/usr/bin/env tsx
/**
 * ensure-science-categories.ts — restore/maintain science categories and backfill
 * existing science articles with the correct category_id/category_slug.
 *
 * Required per project spec: Chemistry, Materials, Biology, Medicine, Physics,
 * Engineering. All have type='science'.
 */

import "dotenv/config";
import { pathToFileURL } from "url";
import { getDb } from "../api/queries/connection";
import { news, categories } from "@db/schema";
import { eq, sql } from "drizzle-orm";

const SCIENCE_CATEGORIES = [
  { name: "Химия", slug: "chemistry", type: "science" },
  { name: "Материаловедение", slug: "materials", type: "science" },
  { name: "Биология", slug: "biology", type: "science" },
  { name: "Медицина", slug: "medicine", type: "science" },
  { name: "Физика", slug: "physics", type: "science" },
  { name: "Инженерия", slug: "engineering", type: "science" },
];

interface ClassifyContext {
  title: string;
  summary: string | null;
  source: string;
  scienceField: string | null;
}

const FIELD_MAP: Record<string, string> = {
  "computer-science": "engineering",
  technology: "engineering",
  multidisciplinary: "",
  medicine: "medicine",
  biology: "biology",
  chemistry: "chemistry",
  materials: "materials",
  physics: "physics",
  engineering: "engineering",
};

const RULES = [
  {
    slug: "chemistry",
    patterns: [/\b(chemistry|chemical|химия|химич|катализ|molecule|molecules|synthesis|organic chemistry|reaction|compound)\b/gi],
  },
  {
    slug: "materials",
    patterns: [/\b(materials|материаловед|материал|matter|crystal|semiconductor|battery|nanotech|nanomaterial|alloy|polymer)\b/gi],
  },
  {
    slug: "biology",
    patterns: [/\b(biology|биология|биолог|gene|genes|protein|proteins|cell|cells|genome|crispr|organism|tissue|biotech|stem cell|epigenetic)\b/gi],
  },
  {
    slug: "medicine",
    patterns: [/\b(medicine|медицина|медицин|medical|health|clinical|disease|oncology|patient|therapy|therapeutic|drug|surgery|diagnosis|vaccine)\b/gi],
  },
  {
    slug: "physics",
    patterns: [/\b(physics|физика|физик|quantum|particle|astro|cosmology|gravity|laser|thermodynamics|superconductor|black hole|spacetime)\b/gi],
  },
  {
    slug: "engineering",
    patterns: [/\b(engineering|инженер|robot|robotics|chip|hardware|compute|computing|algorithm|code|software|system|framework|model|ai tool|neural network|machine learning)\b/gi],
  },
];

export function classifyScience(ctx: ClassifyContext): string {
  const { title, summary, source, scienceField } = ctx;

  // Source-specific overrides for high-confidence routing.
  if (source === "lancet") return "medicine";
  if (source === "cell") return "biology";
  if (source === "mit-tech-review" || source === "arxiv") return "engineering";

  // Map explicit scienceField when available.
  if (scienceField && FIELD_MAP[scienceField]) {
    return FIELD_MAP[scienceField];
  }

  // Keyword scoring over title + summary.
  const text = `${title} ${summary ?? ""}`;
  let bestSlug = "engineering";
  let bestScore = 0;
  for (const rule of RULES) {
    let score = 0;
    for (const re of rule.patterns) {
      re.lastIndex = 0;
      const matches = text.match(re);
      score += matches?.length ?? 0;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSlug = rule.slug;
    }
  }
  return bestSlug;
}

async function main() {
  const db = getDb();

  // 1. Ensure categories exist
  for (const cat of SCIENCE_CATEGORIES) {
    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, cat.slug))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(categories).values(cat);
      console.error(`[science-categories] Created: ${cat.name}`);
    } else {
      // Make sure type is correct if a category was created with wrong type.
      await db.update(categories).set({ type: cat.type }).where(eq(categories.id, existing[0].id));
    }
  }

  // 2. Load id map
  const allCats = await db.select().from(categories);
  const catBySlug = new Map(allCats.map((c) => [c.slug, c]));

  // 3. Backfill all science articles
  const articles = await db
    .select({ id: news.id, title: news.title, summary: news.summary, source: news.source, scienceField: news.scienceField })
    .from(news)
    .where(eq(news.isScience, true));

  const distribution = new Map<string, number>();
  for (const article of articles) {
    const slug = classifyScience(article);
    const cat = catBySlug.get(slug);
    if (!cat) {
      console.error(`[science-categories] WARN: unknown slug ${slug} for #${article.id}`);
      continue;
    }
    await db
      .update(news)
      .set({ categoryId: cat.id, categorySlug: cat.slug, updatedAt: new Date() })
      .where(eq(news.id, article.id));
    distribution.set(slug, (distribution.get(slug) ?? 0) + 1);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        classified: articles.length,
        distribution: Object.fromEntries(distribution),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[science-categories] Failed:", err);
    process.exit(1);
  });
}
