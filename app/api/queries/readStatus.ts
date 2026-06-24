import { getDb } from "./connection";
import { readStatus } from "@db/schema";
import { eq, and, count } from "drizzle-orm";

export async function findReadStatus(userId: number, newsId: number) {
  const db = getDb();
  return db.query.readStatus.findFirst({
    where: and(eq(readStatus.userId, userId), eq(readStatus.newsId, newsId)),
  });
}

export async function markAsRead(userId: number, newsId: number) {
  const db = getDb();
  const existing = await findReadStatus(userId, newsId);

  if (existing) {
    if (!existing.read) {
      await db
        .update(readStatus)
        .set({ read: true, readAt: new Date() })
        .where(eq(readStatus.id, existing.id));
    }
    return { ...existing, read: true };
  }

  const [result] = await db
    .insert(readStatus)
    .values({ userId, newsId, read: true, readAt: new Date() })
    .returning();

  return db.query.readStatus.findFirst({ where: eq(readStatus.id, result.id) });
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
  const [result] = await db
    .select({ count: count() })
    .from(readStatus)
    .where(and(eq(readStatus.userId, userId), eq(readStatus.read, false)));
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
  await db
    .update(readStatus)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(readStatus.userId, userId), eq(readStatus.read, false)));
  return { success: true };
}
