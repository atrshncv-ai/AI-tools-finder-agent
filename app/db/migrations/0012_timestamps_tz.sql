-- Convert every timestamp column from `timestamp without time zone` to
-- `timestamp with time zone`.
--
-- The legacy values are a mix of two conventions, so each column is converted
-- with an explicit zone instead of relying on the session TimeZone:
--   * values written by JS `new Date()` were stored as UTC wall clock;
--   * values written by `defaultNow()` were stored as the database session's
--     local wall clock (Europe/Moscow on the production container).
-- Reading a UTC wall clock as Moscow local time (and the other way round) is
-- what produced the 3-hour shift, so the zone is pinned per column here.
--
-- Columns fed by JS `Date`: publishedAt, platformPublishedAt,
-- digestArchiveSentAt, readAt, lastRun, lastCheck, lastSuccess, startedAt,
-- completedAt, lastVerifiedAt, lastSignInAt → 'UTC'.
-- Columns fed by `defaultNow()`: createdAt / updatedAt of every table →
-- 'Europe/Moscow'.
ALTER TABLE "agent_state" ALTER COLUMN "lastRun" SET DATA TYPE timestamp with time zone USING "lastRun" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "agent_state" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "agent_state" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone USING "updatedAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "favorites" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "invention_tools" ALTER COLUMN "lastVerifiedAt" SET DATA TYPE timestamp with time zone USING "lastVerifiedAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "invention_tools" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "invention_tools" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone USING "updatedAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "news" ALTER COLUMN "publishedAt" SET DATA TYPE timestamp with time zone USING "publishedAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "news" ALTER COLUMN "digestArchiveSentAt" SET DATA TYPE timestamp with time zone USING "digestArchiveSentAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "news" ALTER COLUMN "platformPublishedAt" SET DATA TYPE timestamp with time zone USING "platformPublishedAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "news" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "news" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone USING "updatedAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "parsing_logs" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "pipeline_state" ALTER COLUMN "startedAt" SET DATA TYPE timestamp with time zone USING "startedAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "pipeline_state" ALTER COLUMN "completedAt" SET DATA TYPE timestamp with time zone USING "completedAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "pipeline_state" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "read_status" ALTER COLUMN "readAt" SET DATA TYPE timestamp with time zone USING "readAt" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "read_status" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "source_health" ALTER COLUMN "lastCheck" SET DATA TYPE timestamp with time zone USING "lastCheck" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "source_health" ALTER COLUMN "lastSuccess" SET DATA TYPE timestamp with time zone USING "lastSuccess" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "source_health" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "source_health" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone USING "updatedAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "createdAt" SET DATA TYPE timestamp with time zone USING "createdAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updatedAt" SET DATA TYPE timestamp with time zone USING "updatedAt" AT TIME ZONE 'Europe/Moscow';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "lastSignInAt" SET DATA TYPE timestamp with time zone USING "lastSignInAt" AT TIME ZONE 'UTC';
