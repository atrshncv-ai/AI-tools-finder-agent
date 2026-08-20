ALTER TABLE "news" ADD COLUMN "platformPublishedAt" timestamp;
UPDATE "news" SET "platformPublishedAt" = "updatedAt" WHERE "status" = 'published' AND "platformPublishedAt" IS NULL;
