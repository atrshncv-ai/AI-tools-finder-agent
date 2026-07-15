import { z } from "zod";
import { createRouter, authedQuery, authedMutation } from "./middleware";
import {
  markAsRead,
  markAsUnread,
  markAllAsRead,
  getAllReadStatuses,
  findReadStatus,
  getUnreadCount,
} from "./queries/readStatus";

export const readStatusRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return getAllReadStatuses(ctx.user.id);
  }),

  check: authedQuery
    .input(z.object({ newsId: z.number() }))
    .query(async ({ ctx, input }) => {
      const status = await findReadStatus(ctx.user.id, input.newsId);
      return { read: status?.read ?? false };
    }),

  unreadCount: authedQuery.query(async ({ ctx }) => {
    const count = await getUnreadCount(ctx.user.id);
    return { count };
  }),

  markRead: authedMutation
    .input(z.object({ newsId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return markAsRead(ctx.user.id, input.newsId);
    }),

  markAllRead: authedMutation.mutation(async ({ ctx }) => {
    return markAllAsRead(ctx.user.id);
  }),

  markUnread: authedMutation
    .input(z.object({ newsId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await markAsUnread(ctx.user.id, input.newsId);
      return { success: true };
    }),
});
