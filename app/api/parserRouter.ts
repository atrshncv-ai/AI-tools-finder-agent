import { z } from "zod";
import { createRouter, publicQuery, adminQuery } from "./middleware";
import { runSummarizeAgent, getMetrics, manualRun } from "./agent/index";
import { findRecentLogs } from "./queries/parsingLogs";
import { findAllSources, addSource, removeSource, toggleSource } from "./queries/sources";
import { findAllUsers, updateUserRole } from "./queries/users";
import { checkZenConnection } from "./ai/zenClient";

export const parserRouter = createRouter({
  parse: adminQuery.mutation(async () => {
    const { parseResults } = await manualRun();
    const totalFound = parseResults.reduce((sum: number, r: { articlesFound: number }) => sum + r.articlesFound, 0);
    const totalNew = parseResults.reduce((sum: number, r: { articlesNew: number }) => sum + r.articlesNew, 0);
    const errors = parseResults.filter((r: { success: boolean }) => !r.success).map((r: { error?: string }) => r.error || "Unknown error");
    return { totalFound, totalNew, errors };
  }),

  summarize: adminQuery.mutation(async () => {
    return runSummarizeAgent();
  }),

  logs: publicQuery.query(async () => {
    return findRecentLogs(20);
  }),

  sources: publicQuery.query(async () => {
    return findAllSources();
  }),

  addSource: adminQuery
    .input(
      z.object({
        name: z.string().min(1),
        url: z.string().url(),
        type: z.enum(["rss", "html", "api", "google_news"]),
      })
    )
    .mutation(async ({ input }) => {
      const config: Record<string, unknown> =
        input.type === "rss" || input.type === "google_news"
          ? { feedUrl: input.url }
          : input.type === "api"
          ? { apiUrl: input.url, articlesPath: "articles", titlePath: "title", urlPath: "url" }
          : { selector: "h2 a, h3 a, article a" };

      return addSource({
        name: input.name,
        url: input.url,
        type: input.type,
        config,
      });
    }),

  removeSource: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await removeSource(input.id);
      return { success: true };
    }),

  toggleSource: adminQuery
    .input(z.object({ id: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await toggleSource(input.id, input.enabled);
      return { success: true };
    }),

  status: publicQuery.query(async () => {
    const zenOk = await checkZenConnection();
    const metrics = getMetrics();
    return {
      zen: zenOk,
      sourcesHealth: metrics.sourcesHealth,
    };
  }),

  users: adminQuery.query(async () => {
    return findAllUsers();
  }),

  setUserRole: adminQuery
    .input(
      z.object({
        userId: z.number(),
        role: z.enum(["user", "admin"]),
      })
    )
    .mutation(async ({ input }) => {
      await updateUserRole(input.userId, input.role);
      return { success: true };
    }),
});
