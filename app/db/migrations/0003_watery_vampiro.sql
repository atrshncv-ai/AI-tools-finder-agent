CREATE TABLE "pipeline_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycleId" text NOT NULL,
	"stage" text DEFAULT 'idle' NOT NULL,
	"totalArticles" integer DEFAULT 0 NOT NULL,
	"processedArticles" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_state_cycleId_unique" UNIQUE("cycleId")
);
--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_pipeline_cycle_id" ON "pipeline_state" USING btree ("cycleId");--> statement-breakpoint
CREATE INDEX "idx_pipeline_stage" ON "pipeline_state" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "idx_news_status" ON "news" USING btree ("status");