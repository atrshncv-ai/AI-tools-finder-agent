import { authRouter } from "./auth-router";
import { newsRouter } from "./newsRouter";
import { favoriteRouter } from "./favoriteRouter";
import { readStatusRouter } from "./readStatusRouter";
import { parserRouter } from "./parserRouter";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  health: publicQuery.query(async () => {
    try {
      const db = getDb();
      await db.execute("SELECT 1");
      return { status: "ok", db: "connected", ts: Date.now() };
    } catch {
      return { status: "degraded", db: "disconnected", ts: Date.now() };
    }
  }),
  auth: authRouter,
  news: newsRouter,
  favorite: favoriteRouter,
  readStatus: readStatusRouter,
  parser: parserRouter,
});

export type AppRouter = typeof appRouter;
