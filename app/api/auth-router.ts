import * as cookie from "cookie";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { signSessionToken, JWT_EXPIRY_HOURS } from "./lib/session";
import { findUserByEmail, incrementTokenVersion } from "./queries/users";

const COOKIE_MAX_AGE_SECONDS = JWT_EXPIRY_HOURS * 3600;

/** Never leak the bcrypt hash (or other internals) to the client. */
function sanitizeUser<T extends { password?: string | null }>(user: T): Omit<T, "password"> {
  const { password: _pw, ...safe } = user;
  return safe;
}

/**
 * Private service auth: login/logout/session only. There is NO public
 * registration — accounts are provisioned by the admin via
 * scripts/create-user.ts and handed out manually.
 */
export const authRouter = createRouter({
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
          maxAge: COOKIE_MAX_AGE_SECONDS,
        })
      );

      return { success: true, user: sanitizeUser(user) };
    }),

  me: authedQuery.query((opts) => sanitizeUser(opts.ctx.user)),

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
