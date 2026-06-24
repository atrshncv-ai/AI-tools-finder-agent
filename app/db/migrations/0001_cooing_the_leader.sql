CREATE TABLE "agent_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"lastRun" timestamp,
	"lastError" text,
	"runCount" integer DEFAULT 0 NOT NULL,
	"successCount" integer DEFAULT 0 NOT NULL,
	"failCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_state_agentId_unique" UNIQUE("agentId")
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"sourceId" integer NOT NULL,
	"sourceName" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"lastCheck" timestamp,
	"lastSuccess" timestamp,
	"lastError" text,
	"consecutiveFails" integer DEFAULT 0 NOT NULL,
	"successRate" real DEFAULT 1 NOT NULL,
	"avgResponseTime" integer DEFAULT 0 NOT NULL,
	"selectorWorks" boolean DEFAULT true NOT NULL,
	"runCount" integer DEFAULT 0 NOT NULL,
	"successCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_health_sourceId_unique" UNIQUE("sourceId")
);
--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "translation" text;--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "classificationType" text;--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "updatedAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password" text;--> statement-breakpoint
ALTER TABLE "source_health" ADD CONSTRAINT "source_health_sourceId_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_source_health_status" ON "source_health" USING btree ("status");--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_newsId_news_id_fk" FOREIGN KEY ("newsId") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news" ADD CONSTRAINT "news_categoryId_categories_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsing_logs" ADD CONSTRAINT "parsing_logs_sourceId_sources_id_fk" FOREIGN KEY ("sourceId") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_status" ADD CONSTRAINT "read_status_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_status" ADD CONSTRAINT "read_status_newsId_news_id_fk" FOREIGN KEY ("newsId") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_favorites_user_news" ON "favorites" USING btree ("userId","newsId");--> statement-breakpoint
CREATE INDEX "idx_news_category_id" ON "news" USING btree ("categoryId");--> statement-breakpoint
CREATE INDEX "idx_news_category_slug" ON "news" USING btree ("categorySlug");--> statement-breakpoint
CREATE INDEX "idx_news_is_science" ON "news" USING btree ("isScience");--> statement-breakpoint
CREATE INDEX "idx_news_science_field" ON "news" USING btree ("scienceField");--> statement-breakpoint
CREATE INDEX "idx_news_classification_type" ON "news" USING btree ("classificationType");--> statement-breakpoint
CREATE INDEX "idx_news_published_at" ON "news" USING btree ("publishedAt");--> statement-breakpoint
CREATE INDEX "idx_news_source" ON "news" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_news_original_url" ON "news" USING btree ("originalUrl");--> statement-breakpoint
CREATE INDEX "idx_news_language" ON "news" USING btree ("language");--> statement-breakpoint
CREATE INDEX "idx_news_fts" ON "news" USING gin (to_tsvector('russian', "title" || ' ' || coalesce("summary", '') || ' ' || coalesce("content", '') || ' ' || coalesce("translation", '')));--> statement-breakpoint
CREATE INDEX "idx_parsing_logs_source_id" ON "parsing_logs" USING btree ("sourceId");--> statement-breakpoint
CREATE INDEX "idx_parsing_logs_created_at" ON "parsing_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_read_status_user_news" ON "read_status" USING btree ("userId","newsId");--> statement-breakpoint
CREATE INDEX "idx_read_status_read" ON "read_status" USING btree ("read");--> statement-breakpoint
CREATE INDEX "idx_sources_enabled" ON "sources" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_sources_type" ON "sources" USING btree ("type");