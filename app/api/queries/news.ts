import { getDb } from "./connection";
import { news, categories } from "@db/schema";
import { eq, inArray, desc, and, count, sql, getTableColumns } from "drizzle-orm";

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
  classificationType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const { isScience, categorySlug, classificationType, search, limit = 50, offset = 0 } = opts;

  const conditions = [];

  conditions.push(eq(news.status, "published"));

  if (isScience !== undefined) {
    conditions.push(eq(news.isScience, isScience));
  }

  if (categorySlug && categorySlug.length > 0) {
    conditions.push(inArray(news.categorySlug, categorySlug));
  }

  if (classificationType) {
    conditions.push(eq(news.classificationType, classificationType));
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
