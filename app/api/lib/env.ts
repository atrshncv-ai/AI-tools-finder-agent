import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OWNER_UNION_ID: z.string().default(""),
  CORS_ORIGIN: z.string().default(""),
  PORT: z.string().default("3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Environment validation failed: ${issues}`);
}

const raw = parsed.data;

export const env = {
  isProduction: raw.NODE_ENV === "production",
  databaseUrl: raw.DATABASE_URL,
  ownerUnionId: raw.OWNER_UNION_ID,
  corsOrigin: raw.CORS_ORIGIN,
  port: parseInt(raw.PORT, 10),
};
