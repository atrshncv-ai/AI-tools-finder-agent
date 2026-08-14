CREATE TABLE "invention_tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"organization" text,
	"country" text,
	"kind" text NOT NULL,
	"spheres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accessStatus" text NOT NULL,
	"description" text NOT NULL,
	"officialUrl" text NOT NULL,
	"docsUrl" text,
	"lastVerifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invention_tools_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "section" text DEFAULT 'ai-news' NOT NULL;--> statement-breakpoint
ALTER TABLE "news" ADD COLUMN "sphereTags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_invention_tools_kind" ON "invention_tools" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_news_section" ON "news" USING btree ("section");