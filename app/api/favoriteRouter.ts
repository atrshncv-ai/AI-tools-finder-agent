import { z } from "zod";
import { createRouter, authedQuery, authedMutation } from "./middleware";
import {
  findFavoritesByUser,
  addFavorite,
  removeFavorite,
  countFavorites,
  findFavorite,
} from "./queries/favorites";

export const favoriteRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return findFavoritesByUser(ctx.user.id);
  }),

  check: authedQuery
    .input(z.object({ newsId: z.number() }))
    .query(async ({ ctx, input }) => {
      const fav = await findFavorite(ctx.user.id, input.newsId);
      return { isFavorite: !!fav };
    }),

  add: authedMutation
    .input(z.object({ newsId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return addFavorite(ctx.user.id, input.newsId);
    }),

  remove: authedMutation
    .input(z.object({ newsId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await removeFavorite(ctx.user.id, input.newsId);
      return { success: true };
    }),

  count: authedQuery.query(async ({ ctx }) => {
    const cnt = await countFavorites(ctx.user.id);
    return { count: cnt };
  }),
});
