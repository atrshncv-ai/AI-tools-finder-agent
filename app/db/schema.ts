import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  real,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Users (OAuth) ---
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  unionId: text("unionId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  password: text("password"),
  avatar: text("avatar"),
  role: text("role").default("user").notNull(),
  tokenVersion: integer("tokenVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// --- Categories ---
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").default("general").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Category = typeof categories.$inferSelect;
export type InsertCategory = typeof categories.$inferInsert;

// --- News ---
export const news = pgTable(
  "news",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    content: text("content"),
    originalContent: text("originalContent"),
    translation: text("translation"),
    originalUrl: text("originalUrl").notNull(),
    source: text("source").notNull(),
    categoryId: integer("categoryId").references(() => categories.id),
    categorySlug: text("categorySlug"),
    tags: text("tags"),
    imageUrl: text("imageUrl"),
    publishedAt: timestamp("publishedAt").notNull(),
    isScience: boolean("isScience").default(false).notNull(),
    scienceField: text("scienceField"),
    classificationType: text("classificationType"),
    language: text("language"),
    status: text("status").default("pending").notNull(),
    modelUsed: text("modelUsed"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("idx_news_category_id").on(table.categoryId),
    index("idx_news_category_slug").on(table.categorySlug),
    index("idx_news_is_science").on(table.isScience),
    index("idx_news_science_field").on(table.scienceField),
    index("idx_news_classification_type").on(table.classificationType),
    index("idx_news_published_at").on(table.publishedAt),
    index("idx_news_source").on(table.source),
    index("idx_news_status").on(table.status),
    uniqueIndex("idx_news_original_url").on(table.originalUrl),
    index("idx_news_language").on(table.language),
    index("idx_news_fts").using(
      "gin",
      sql`to_tsvector('russian', ${table.title} || ' ' || coalesce(${table.summary}, '') || ' ' || coalesce(${table.content}, '') || ' ' || coalesce(${table.translation}, ''))`,
    ),
  ],
);

export type News = typeof news.$inferSelect;
export type InsertNews = typeof news.$inferInsert;

// --- Favorites ---
export const favorites = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    newsId: integer("newsId")
      .notNull()
      .references(() => news.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("uniq_favorites_user_news").on(table.userId, table.newsId)],
);

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = typeof favorites.$inferInsert;

// --- Read Status ---
export const readStatus = pgTable(
  "read_status",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    newsId: integer("newsId")
      .notNull()
      .references(() => news.id, { onDelete: "cascade" }),
    read: boolean("read").default(false).notNull(),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uniq_read_status_user_news").on(table.userId, table.newsId),
    index("idx_read_status_read").on(table.read),
  ],
);

export type ReadStatus = typeof readStatus.$inferSelect;
export type InsertReadStatus = typeof readStatus.$inferInsert;

// --- Sources (for parsing) ---
export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    type: text("type").notNull(),
    config: jsonb("config"),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("idx_sources_enabled").on(table.enabled),
    index("idx_sources_type").on(table.type),
  ],
);

export type Source = typeof sources.$inferSelect;
export type InsertSource = typeof sources.$inferInsert;

// --- Parsing Logs ---
export const parsingLogs = pgTable(
  "parsing_logs",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("sourceId")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    articlesFound: integer("articlesFound").default(0),
    articlesNew: integer("articlesNew").default(0),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("idx_parsing_logs_source_id").on(table.sourceId),
    index("idx_parsing_logs_created_at").on(table.createdAt),
  ],
);

export type ParsingLog = typeof parsingLogs.$inferSelect;
export type InsertParsingLog = typeof parsingLogs.$inferInsert;

// --- Agent State (persistent) ---
export const agentState = pgTable("agent_state", {
  id: serial("id").primaryKey(),
  agentId: text("agentId").notNull().unique(),
  status: text("status").default("idle").notNull(),
  lastRun: timestamp("lastRun"),
  lastError: text("lastError"),
  runCount: integer("runCount").default(0).notNull(),
  successCount: integer("successCount").default(0).notNull(),
  failCount: integer("failCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AgentStateRow = typeof agentState.$inferSelect;
export type InsertAgentState = typeof agentState.$inferInsert;

// --- Source Health (persistent) ---
export const sourceHealth = pgTable(
  "source_health",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("sourceId")
      .notNull()
      .unique()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceName: text("sourceName").notNull(),
    status: text("status").default("unknown").notNull(),
    lastCheck: timestamp("lastCheck"),
    lastSuccess: timestamp("lastSuccess"),
    lastError: text("lastError"),
    consecutiveFails: integer("consecutiveFails").default(0).notNull(),
    successRate: real("successRate").default(1).notNull(),
    avgResponseTime: integer("avgResponseTime").default(0).notNull(),
    selectorWorks: boolean("selectorWorks").default(true).notNull(),
    runCount: integer("runCount").default(0).notNull(),
    successCount: integer("successCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [index("idx_source_health_status").on(table.status)],
);

export type SourceHealthRow = typeof sourceHealth.$inferSelect;
export type InsertSourceHealth = typeof sourceHealth.$inferInsert;

// --- Pipeline State (per-cycle tracking) ---
export const pipelineState = pgTable(
  "pipeline_state",
  {
    id: serial("id").primaryKey(),
    cycleId: text("cycleId").notNull().unique(),
    stage: text("stage").default("idle").notNull(),
    totalArticles: integer("totalArticles").default(0).notNull(),
    processedArticles: integer("processedArticles").default(0).notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("idx_pipeline_cycle_id").on(table.cycleId),
    index("idx_pipeline_stage").on(table.stage),
  ],
);

export type PipelineStateRow = typeof pipelineState.$inferSelect;
export type InsertPipelineState = typeof pipelineState.$inferInsert;
