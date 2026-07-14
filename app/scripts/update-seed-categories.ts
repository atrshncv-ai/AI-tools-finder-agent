#!/usr/bin/env tsx
/**
 * update-seed-categories.ts — one-off classifier for seed AI tools.
 *
 * Ensures tech categories exist, then assigns each seed-data article
 * to the best matching category by keyword scoring.
 */

import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { news, categories } from "@db/schema";
import { eq, sql, inArray, and } from "drizzle-orm";

const TECH_CATEGORIES = [
  { name: "AI Agents", slug: "ai-agents", type: "general" },
  { name: "Developer Tools", slug: "developer-tools", type: "general" },
  { name: "Automation", slug: "automation", type: "general" },
  { name: "RAG & Data", slug: "rag-data", type: "general" },
  { name: "Frameworks", slug: "frameworks", type: "general" },
];

interface Rule {
  slug: string;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    slug: "ai-agents",
    patterns: [
      /\b(agent|agents|агент|агенты|агентный|агентов|агентские|agentic|autonomous|multi-agent|claude code|оркестрация|swarm)\b/gi,
    ],
  },
  {
    slug: "developer-tools",
    patterns: [
      /\b(code|coding|developer|программирование|рефакторинг|codebase|code review|git|github|terminal|cli|ide|editor|pair programming|smallcode|aider|opencode|kimi-cli|qoder|coderabbit|huashu|antigravity)\b/gi,
    ],
  },
  {
    slug: "automation",
    patterns: [
      /\b(automation|автоматизация|workflow|pipeline|ci\/cd|deploy|деплой|orchestration|router|routing|harness|lead finder|tg-lead|hyperframes|claude-video|product-manager|codebase-to-course|9router)\b/gi,
    ],
  },
  {
    slug: "rag-data",
    patterns: [
      /\b(rag|retrieval|knowledge graph|data|document|pdf|markdown|index|indexing|dataset|vector|embedding|search|поиск|memory|llmlingua|token savior|mark it down|graphify|codebase memory)\b/gi,
    ],
  },
  {
    slug: "frameworks",
    patterns: [
      /\b(framework|library|sdk|platform|harness|stack|langgraph|vercel ai sdk|open-source система|pocket-tts|token| deerflow|ralph loop|lunar\.dev|haystack|agentshield)\b/gi,
    ],
  },
];

const DEFAULT_SLUG = "frameworks";

function classify(text: string): string {
  const scores = RULES.map((rule) => {
    let score = 0;
    for (const re of rule.patterns) {
      re.lastIndex = 0;
      const matches = text.match(re);
      score += matches?.length ?? 0;
    }
    return { slug: rule.slug, score };
  });

  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  return best.score > 0 ? best.slug : DEFAULT_SLUG;
}

async function main() {
  const db = getDb();

  // 1. Ensure tech categories exist
  for (const cat of TECH_CATEGORIES) {
    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, cat.slug))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(categories).values(cat);
      console.error(`[seed-categories] Created category: ${cat.name}`);
    }
  }

  // 2. Load category id map
  const allCats = await db.select().from(categories);
  const catBySlug = new Map(allCats.map((c) => [c.slug, c]));

  // 3. Fetch seed articles
  const articles = await db
    .select({ id: news.id, title: news.title, summary: news.summary, categorySlug: news.categorySlug })
    .from(news)
    .where(eq(news.source, "seed-data"));

  console.error(`[seed-categories] Found ${articles.length} seed articles`);

  // 4. Classify and update
  const distribution = new Map<string, number>();
  for (const article of articles) {
    const text = `${article.title} ${article.summary ?? ""}`;
    const slug = classify(text);
    const cat = catBySlug.get(slug);
    if (!cat) {
      console.error(`[seed-categories] WARN: unknown slug ${slug} for #${article.id}`);
      continue;
    }

    await db
      .update(news)
      .set({
        categoryId: cat.id,
        categorySlug: cat.slug,
        updatedAt: new Date(),
      })
      .where(eq(news.id, article.id));

    distribution.set(slug, (distribution.get(slug) ?? 0) + 1);
    console.error(`[seed-categories] #${article.id} → ${cat.name}`);
  }

  // 5. Remove obsolete general categories that have zero articles
  const obsoleteSlugs = ["new-llm", "ai-agent", "comparison", "benchmarks", "updates"];
  const obsoleteCats = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(and(inArray(categories.slug, obsoleteSlugs), eq(categories.type, "general")));

  for (const cat of obsoleteCats) {
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(news)
      .where(eq(news.categoryId, cat.id));
    if (cnt === 0) {
      await db.delete(categories).where(eq(categories.id, cat.id));
      console.error(`[seed-categories] Removed obsolete category: ${cat.slug}`);
    }
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

main().catch((err) => {
  console.error("[seed-categories] Failed:", err);
  process.exit(1);
});
