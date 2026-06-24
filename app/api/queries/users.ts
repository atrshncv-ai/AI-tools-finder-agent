import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function findUserByEmail(email: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  return rows.at(0);
}

export async function findAllUsers() {
  const db = getDb();
  return db
    .select({
      id: users.id,
      unionId: users.unionId,
      name: users.name,
      email: users.email,
      avatar: users.avatar,
      role: users.role,
      createdAt: users.createdAt,
      lastSignInAt: users.lastSignInAt,
    })
    .from(users)
    .orderBy(users.createdAt);
}

export async function incrementTokenVersion(unionId: string) {
  const db = getDb();
  const user = await findUserByUnionId(unionId);
  if (!user) return;
  await db
    .update(users)
    .set({ tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
    .where(eq(users.unionId, unionId));
}

export async function updateUserRole(userId: number, role: string) {
  const db = getDb();
  await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...data,
  };
  delete (updateSet as Record<string, unknown>).tokenVersion;

  if (
    values.role === undefined &&
    values.unionId &&
    values.unionId === env.ownerUnionId
  ) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  await getDb()
    .insert(schema.users)
    .values(values)
    .onConflictDoUpdate({
      target: schema.users.unionId,
      set: updateSet,
    });
}
