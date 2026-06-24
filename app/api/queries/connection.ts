import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let client: ReturnType<typeof postgres>;

export function getDb() {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    client = postgres(connectionString);
    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}

export async function closeDb() {
  if (client) {
    await client.end();
  }
}
