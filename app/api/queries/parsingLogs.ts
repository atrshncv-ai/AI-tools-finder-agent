import { getDb } from "./connection";
import { parsingLogs } from "@db/schema";
import { eq, desc } from "drizzle-orm";

export async function createParsingLog(data: {
  sourceId: number;
  status: string;
  articlesFound?: number;
  articlesNew?: number;
  errorMessage?: string;
}) {
  const db = getDb();
  const [log] = await db.insert(parsingLogs).values(data).returning();
  return log;
}

export async function updateParsingLog(
  id: number,
  data: {
    status?: string;
    articlesFound?: number;
    articlesNew?: number;
    errorMessage?: string;
  }
) {
  const db = getDb();
  const [log] = await db
    .update(parsingLogs)
    .set(data)
    .where(eq(parsingLogs.id, id))
    .returning();
  return log;
}

export async function findRecentLogs(limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(parsingLogs)
    .orderBy(desc(parsingLogs.createdAt))
    .limit(limit);
}

export async function findLogsBySource(sourceId: number, limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(parsingLogs)
    .where(eq(parsingLogs.sourceId, sourceId))
    .orderBy(desc(parsingLogs.createdAt))
    .limit(limit);
}
