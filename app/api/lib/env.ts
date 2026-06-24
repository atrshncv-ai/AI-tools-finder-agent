import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ID: z.string().min(1, "APP_ID is required"),
  APP_SECRET: z.string().min(1, "APP_SECRET is required"),
  KIMI_AUTH_URL: z.string().url(),
  KIMI_OPEN_URL: z.string().url(),
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
  appId: raw.APP_ID,
  appSecret: raw.APP_SECRET,
  isProduction: raw.NODE_ENV === "production",
  databaseUrl: raw.DATABASE_URL,
  kimiAuthUrl: raw.KIMI_AUTH_URL,
  kimiOpenUrl: raw.KIMI_OPEN_URL,
  ownerUnionId: raw.OWNER_UNION_ID,
  corsOrigin: raw.CORS_ORIGIN,
  port: parseInt(raw.PORT, 10),
};
