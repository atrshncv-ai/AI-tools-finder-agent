import { relations } from "drizzle-orm";
import { users, news, categories, favorites, readStatus, sources, parsingLogs } from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  favorites: many(favorites),
  readStatuses: many(readStatus),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  news: many(news),
}));

export const newsRelations = relations(news, ({ one, many }) => ({
  category: one(categories, {
    fields: [news.categoryId],
    references: [categories.id],
  }),
  favorites: many(favorites),
  readStatuses: many(readStatus),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
  news: one(news, {
    fields: [favorites.newsId],
    references: [news.id],
  }),
}));

export const readStatusRelations = relations(readStatus, ({ one }) => ({
  user: one(users, {
    fields: [readStatus.userId],
    references: [users.id],
  }),
  news: one(news, {
    fields: [readStatus.newsId],
    references: [news.id],
  }),
}));

export const sourcesRelations = relations(sources, ({ many }) => ({
  parsingLogs: many(parsingLogs),
}));

export const parsingLogsRelations = relations(parsingLogs, ({ one }) => ({
  source: one(sources, {
    fields: [parsingLogs.sourceId],
    references: [sources.id],
  }),
}));
