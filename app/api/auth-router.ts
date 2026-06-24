import * as cookie from "cookie";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { signSessionToken } from "./kimi/session";
import { findUserByUnionId, upsertUser, findUserByEmail, incrementTokenVersion } from "./queries/users";

const BCRYPT_ROUNDS = 12;

export const authRouter = createRouter({
  register: publicQuery
    .input(
      z.object({
        name: z.string().min(2, "Имя должно быть не менее 2 символов"),
        email: z.string().email("Некорректный email"),
        password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await findUserByEmail(input.email);
      if (existing) {
        throw new Error("Пользователь с таким email уже существует");
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      const unionId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await upsertUser({
        unionId,
        name: input.name,
        email: input.email,
        password: passwordHash,
        role: "user",
        lastSignInAt: new Date(),
      });

      const token = await signSessionToken({
        unionId,
        clientId: "app",
        tokenVersion: 1,
      });

      const cookieOpts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: cookieOpts.httpOnly,
          path: cookieOpts.path,
          sameSite: cookieOpts.sameSite as "lax" | "none",
          secure: cookieOpts.secure,
          maxAge: Session.maxAgeMs / 1000,
        })
      );

      const user = await findUserByUnionId(unionId);
      return { success: true, user };
    }),

  login: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await findUserByEmail(input.email);
      if (!user || !user.password) {
        throw new Error("Неверный email или пароль");
      }

      const valid = await bcrypt.compare(input.password, user.password);
      if (!valid) {
        throw new Error("Неверный email или пароль");
      }

      const token = await signSessionToken({
        unionId: user.unionId,
        clientId: "app",
        tokenVersion: user.tokenVersion,
      });

      const cookieOpts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: cookieOpts.httpOnly,
          path: cookieOpts.path,
          sameSite: cookieOpts.sameSite as "lax" | "none",
          secure: cookieOpts.secure,
          maxAge: Session.maxAgeMs / 1000,
        })
      );

      return { success: true, user };
    }),

  me: authedQuery.query((opts) => opts.ctx.user),

  logout: authedQuery.mutation(async ({ ctx }) => {
    await incrementTokenVersion(ctx.user.unionId);
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});
