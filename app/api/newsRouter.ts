import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import {
  findAllNews,
  findNewsById,
  findCategories,
  findInventionTools,
  findInventionToolSpheres,
  findInventionToolById,
  seedCategories,
} from "./queries/news";
import { translateArticle } from "./ai/zenClient";
import { getDb } from "./queries/connection";
import { news } from "@db/schema";
import { eq } from "drizzle-orm";

export const newsRouter = createRouter({
  list: authedQuery
    .input(
      z
        .object({
          isScience: z.boolean().optional(),
          categorySlug: z.array(z.string()).optional(),
          section: z.enum(["ai-news", "science", "invention-tools"]).optional(),
          classificationType: z.enum(["new_tool", "update", "closure", "achievement"]).optional(),
          search: z.string().optional(),
          freshness: z.enum(["all", "day", "3days", "week", "month"]).optional(),
          limit: z.number().min(1).max(300).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return findAllNews({
        isScience: input?.isScience,
        categorySlug: input?.categorySlug,
        section: input?.section,
        classificationType: input?.classificationType,
        search: input?.search,
        freshness: input?.freshness,
        limit: input?.limit,
        offset: input?.offset,
      });
    }),

  byId: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return findNewsById(input.id);
    }),

  categories: authedQuery
    .input(z.object({ type: z.enum(["general", "science"]).optional() }).optional())
    .query(async ({ input }) => {
      return findCategories(input?.type);
    }),

  translate: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const article = await db.query.news.findFirst({
        where: eq(news.id, input.id),
      });

      if (!article) {
        throw new Error("Article not found");
      }

      // If the article is already in Russian, no need to call LLM
      if (article.language === "ru") {
        const russianText = article.originalContent || article.content || article.summary;
        return { translation: russianText };
      }

      const fullText = article.originalContent || article.content || article.summary;
      const translation = await translateArticle(
        article.title,
        fullText,
        article.source
      );

      // Cache translation in DB for future requests
      if (translation && translation.trim().length > 0) {
        await db.update(news)
          .set({ translation, updatedAt: new Date() })
          .where(eq(news.id, article.id));
      }

      return { translation };
    }),

  seed: adminQuery.mutation(async () => {
    await seedCategories();
    return { success: true };
  }),

  inventionTools: authedQuery
    .input(z.object({ spheres: z.array(z.string()).optional(), limit: z.number().min(1).max(300).optional() }).optional())
    .query(({ input }) => findInventionTools({ spheres: input?.spheres, limit: input?.limit })),

  inventionToolSpheres: authedQuery.query(() => findInventionToolSpheres()),

  inventionToolById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const tool = await findInventionToolById(input.id);
      if (!tool) throw new Error("Tool not found");
      return tool;
    }),
});
