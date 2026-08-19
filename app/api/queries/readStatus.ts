import { getDb } from "./connection";
import { news, readStatus } from "@db/schema";
import { eq, and, count, isNull, isNotNull, ne, sql } from "drizzle-orm";

export async function findReadStatus(userId: number, newsId: number) {
  const db = getDb();
  return db.query.readStatus.findFirst({
    where: and(eq(readStatus.userId, userId), eq(readStatus.newsId, newsId)),
  });
}

export async function markAsRead(userId: number, newsId: number) {
  const db = getDb();
  const existing = await findReadStatus(userId, newsId);
  if (existing?.read) return existing;

  const [result] = await db
    .insert(readStatus)
    .values({ userId, newsId, read: true, readAt: new Date() })
    .onConflictDoUpdate({
      target: [readStatus.userId, readStatus.newsId],
      set: { read: true, readAt: new Date() },
    })
    .returning();

  return result;
}

export async function markAsUnread(userId: number, newsId: number) {
  const db = getDb();
  await db
    .update(readStatus)
    .set({ read: false, readAt: null })
    .where(and(eq(readStatus.userId, userId), eq(readStatus.newsId, newsId)));
}

export async function getUnreadCount(userId: number) {
  const db = getDb();
  // Unread = published-with-summary articles that have NO read=true row.
  // Counting only read_status rows (old version) ignored articles the user
  // never opened — those had no row at all and were invisible to the badge.
  const [result] = await db
    .select({ count: count() })
    .from(news)
    .leftJoin(
      readStatus,
      and(
        eq(readStatus.userId, userId),
        eq(readStatus.newsId, news.id),
        eq(readStatus.read, true),
      ),
    )
    .where(
      and(
        eq(news.status, "published"),
        isNotNull(news.summary),
        ne(news.summary, ""),
        isNull(readStatus.id),
      ),
    );
  return result.count;
}

export async function getUnreadCountBySection(
  userId: number,
  section: "ai-news" | "science" | "invention-tools",
) {
  const db = getDb();
  const [result] = await db
    .select({ count: count() })
    .from(news)
    .leftJoin(
      readStatus,
      and(
        eq(readStatus.userId, userId),
        eq(readStatus.newsId, news.id),
        eq(readStatus.read, true),
      ),
    )
    .where(
      and(
        eq(news.status, "published"),
        eq(news.section, section),
        isNotNull(news.summary),
        ne(news.summary, ""),
        isNull(readStatus.id),
      ),
    );
  return result.count;
}

export async function getAllReadStatuses(userId: number) {
  const db = getDb();
  return db
    .select()
    .from(readStatus)
    .where(eq(readStatus.userId, userId));
}

export async function markAllAsRead(userId: number) {
  const db = getDb();
  // Two steps, both idempotent:
  // 1) INSERT read=true rows for published-with-summary articles the user has
  //    no row for (otherwise their badge would never clear — "mark all read"
  //    used to touch only rows that already existed).
  // 2) UPDATE existing unread rows to read=true.
  await db.execute(sql`
    INSERT INTO read_status ("userId", "newsId", read, "readAt")
    SELECT ${userId}, n.id, true, NOW()
    FROM news n
    WHERE n.status = 'published'
      AND n.summary IS NOT NULL AND n.summary <> ''
      AND NOT EXISTS (
        SELECT 1 FROM read_status rs
        WHERE rs."userId" = ${userId} AND rs."newsId" = n.id
      )
  `);
  await db
    .update(readStatus)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(readStatus.userId, userId), eq(readStatus.read, false)));
  return { success: true };
}
