ALTER TABLE "news" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
CREATE INDEX "idx_news_score" ON "news" USING btree ("score");