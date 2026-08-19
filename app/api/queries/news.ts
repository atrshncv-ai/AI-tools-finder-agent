import { getDb } from "./connection";
import { news, categories, inventionTools } from "@db/schema";
import { eq, inArray, desc, and, count, sql, getTableColumns, gte } from "drizzle-orm";

// Freshness windows in hours — matches src/components/FreshnessFilter.tsx.
const FRESHNESS_HOURS: Record<string, number> = {
  day: 24,
  "3days": 72,
  week: 7 * 24,
  month: 30 * 24,
};

// ─── Seed categories ───
export async function seedCategories() {
  const db = getDb();
  const existing = await db.select().from(categories);
  if (existing.length > 0) return;

  const cats = [
    { name: "AI Agents", slug: "ai-agents", type: "general" },
    { name: "Developer Tools", slug: "developer-tools", type: "general" },
    { name: "Automation", slug: "automation", type: "general" },
    { name: "RAG & Data", slug: "rag-data", type: "general" },
    { name: "Frameworks", slug: "frameworks", type: "general" },
    { name: "Химия", slug: "chemistry", type: "science" },
    { name: "Материаловедение", slug: "materials", type: "science" },
    { name: "Биология", slug: "biology", type: "science" },
    { name: "Медицина", slug: "medicine", type: "science" },
    { name: "Физика", slug: "physics", type: "science" },
    { name: "Инженерия", slug: "engineering", type: "science" },
  ];

  for (const c of cats) {
    await db.insert(categories).values(c);
  }
}

// ─── Queries ───
export async function findAllNews(opts: {
  isScience?: boolean;
  categorySlug?: string[];
  section?: string;
  classificationType?: string;
  search?: string;
  freshness?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const { isScience, categorySlug, section, classificationType, search, freshness, limit = 50, offset = 0 } = opts;

  const conditions = [];

  conditions.push(eq(news.status, "published"));
  // Dashboard listing must exclude cards without a summary (empty/null).
  // Direct article links via findNewsById remain unaffected.
  conditions.push(sql`${news.summary} is not null and ${news.summary} <> ''`);

  if (isScience !== undefined) {
    conditions.push(eq(news.isScience, isScience));
  }

  if (categorySlug && categorySlug.length > 0) {
    conditions.push(inArray(news.categorySlug, categorySlug));
  }
  if (section) conditions.push(eq(news.section, section));

  if (classificationType) {
    conditions.push(eq(news.classificationType, classificationType));
  }

  // Freshness = when the article was published by the original SOURCE
  // (publishedAt). Using updatedAt would pull in old backlog articles that
  // were re-published today by the pipeline, showing July content in the
  // "today" view.
  if (freshness && freshness !== "all") {
    const hours = FRESHNESS_HOURS[freshness];
    if (hours) {
      conditions.push(gte(news.publishedAt, new Date(Date.now() - hours * 3600_000)));
    }
  }

  if (search) {
    const q = search.trim();
    if (q.length > 0) {
      conditions.push(
        sql`to_tsvector('russian', ${news.title} || ' ' || coalesce(${news.summary}, '') || ' ' || coalesce(${news.content}, '') || ' ' || coalesce(${news.translation}, '')) @@ plainto_tsquery('russian', ${q})`,
      );
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select({
      ...getTableColumns(news),
      categoryName: categories.name,
    })
    .from(news)
    .leftJoin(categories, eq(news.categoryId, categories.id))
    .where(where)
    .orderBy(desc(news.publishedAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: count() })
    .from(news)
    .where(where);

  return { items, total: totalResult.count };
}

export async function findInventionTools(opts: { sphere?: string; spheres?: string[]; limit?: number } = {}) {
  const db = getDb();
  const rows = await db.select().from(inventionTools).orderBy(inventionTools.name).limit(opts.limit ?? 200);
  if (opts.spheres && opts.spheres.length > 0) {
    return rows.filter((tool) => tool.spheres.some((s) => opts.spheres!.includes(s)));
  }
  if (opts.sphere) return rows.filter((tool) => tool.spheres.includes(opts.sphere!));
  return rows;
}

export async function findInventionToolSpheres(): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ spheres: inventionTools.spheres }).from(inventionTools);
  const set = new Set<string>();
  for (const row of rows) for (const s of row.spheres) set.add(s);
  return [...set].sort();
}

export async function findInventionToolById(id: number) {
  const db = getDb();
  const [row] = await db.select().from(inventionTools).where(eq(inventionTools.id, id)).limit(1);
  return row ?? null;
}

export async function findNewsById(id: number) {
  const db = getDb();
  return db.query.news.findFirst({
    where: eq(news.id, id),
    with: { category: true },
  });
}

export async function findCategories(type?: "general" | "science") {
  const db = getDb();
  if (type) {
    return db.select().from(categories).where(eq(categories.type, type));
  }
  return db.select().from(categories);
}
