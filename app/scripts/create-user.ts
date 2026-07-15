#!/usr/bin/env tsx
/**
 * create-user.ts — provision client accounts for the private service.
 *
 * Accounts are created ONLY here (there is no public registration).
 * Run on the server, hand the printed credentials to the client manually.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts --email client@example.com [--name "Client Name"] [--role user|admin] [--password <pwd>]
 *
 * If --password is omitted, a strong random password is generated.
 * If the email already exists, the password/role/name are UPDATED
 * (useful for password resets).
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb } from "../api/queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";

const BCRYPT_ROUNDS = 12;

function parseArgs(): { email: string | null; name: string; role: string; password: string | null } {
  const a = process.argv.slice(2);
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] || null : null;
  };
  return {
    email: get("--email"),
    name: get("--name") || "",
    role: get("--role") || "user",
    password: get("--password"),
  };
}

/** Human-friendly random password: 4 groups of 4 chars, no ambiguous glyphs. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12), chars.slice(12, 16)]
    .map((g) => g.join(""))
    .join("-");
}

async function main() {
  const { email, name, role, password } = parseArgs();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    console.error("Usage: npx tsx scripts/create-user.ts --email <email> [--name <name>] [--role user|admin] [--password <pwd>]");
    process.exit(1);
  }
  if (!["user", "admin"].includes(role)) {
    console.error(`Invalid --role "${role}" (expected user|admin)`);
    process.exit(1);
  }

  const plainPassword = password || generatePassword();
  if (plainPassword.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);

  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing.length > 0) {
    await db
      .update(users)
      .set({
        password: passwordHash,
        role,
        ...(name ? { name } : {}),
        // Bump tokenVersion so all previously issued sessions die immediately.
        tokenVersion: existing[0].tokenVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));
    console.error(`[create-user] updated existing user #${existing[0].id} (sessions revoked)`);
  } else {
    const unionId = `user-${randomBytes(8).toString("hex")}`;
    await db.insert(users).values({
      unionId,
      name: name || email.split("@")[0],
      email,
      password: passwordHash,
      role,
      lastSignInAt: new Date(),
    });
    console.error("[create-user] new user created");
  }

  // Credentials go to STDOUT so they can be captured; diagnostics to STDERR.
  console.log(
    JSON.stringify({
      status: existing.length > 0 ? "updated" : "created",
      email,
      password: plainPassword,
      role,
    }),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[create-user] Fatal error:", err);
  process.exit(1);
});
