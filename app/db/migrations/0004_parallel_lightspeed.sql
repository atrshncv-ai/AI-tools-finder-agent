ALTER TABLE "news" ADD COLUMN "modelUsed" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokenVersion" integer DEFAULT 1 NOT NULL;