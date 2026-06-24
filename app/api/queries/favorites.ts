import { getDb } from "./connection";
import { favorites, news } from "@db/schema";
import { eq, and, desc, count } from "drizzle-orm";

export async function findFavoritesByUser(userId: number) {
  const db = getDb();
  return db
    .select({
      id: favorites.id,
      newsId: favorites.newsId,
      createdAt: favorites.createdAt,
      news: {
        id: news.id,
        title: news.title,
        summary: news.summary,
        content: news.content,
        originalContent: news.originalContent,
        translation: news.translation,
        originalUrl: news.originalUrl,
        source: news.source,
        categoryId: news.categoryId,
        categorySlug: news.categorySlug,
        tags: news.tags,
        imageUrl: news.imageUrl,
        publishedAt: news.publishedAt,
        isScience: news.isScience,
        scienceField: news.scienceField,
        classificationType: news.classificationType,
        language: news.language,
        status: news.status,
        modelUsed: news.modelUsed,
        createdAt: news.createdAt,
        updatedAt: news.updatedAt,
      },
    })
    .from(favorites)
    .innerJoin(news, eq(favorites.newsId, news.id))
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt));
}

export async function findFavorite(userId: number, newsId: number) {
  const db = getDb();
  return db.query.favorites.findFirst({
    where: and(eq(favorites.userId, userId), eq(favorites.newsId, newsId)),
  });
}

export async function addFavorite(userId: number, newsId: number) {
  const db = getDb();
  const existing = await findFavorite(userId, newsId);
  if (existing) return existing;

  const [result] = await db
    .insert(favorites)
    .values({ userId, newsId })
    .returning();

  return db.query.favorites.findFirst({ where: eq(favorites.id, result.id) });
}

export async function removeFavorite(userId: number, newsId: number) {
  const db = getDb();
  await db
    .delete(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.newsId, newsId)));
}

export async function countFavorites(userId: number) {
  const db = getDb();
  const [result] = await db
    .select({ count: count() })
    .from(favorites)
    .where(eq(favorites.userId, userId));
  return result.count;
}
