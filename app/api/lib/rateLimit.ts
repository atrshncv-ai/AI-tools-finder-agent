import type { MiddlewareHandler } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Build a tRPC-shaped error envelope so @trpc/client can parse a 429
 * response into a proper TRPCClientError instead of dying with
 * "Unable to transform response from server". Batch calls (?batch=1)
 * require an ARRAY of envelopes, single calls a plain object.
 */
function tooManyRequestsBody(path: string, isBatch: boolean) {
  const envelope = {
    error: {
      json: {
        message: "Too many requests. Please retry in a minute.",
        code: -32029, // tRPC error code: TOO_MANY_REQUESTS
        data: {
          code: "TOO_MANY_REQUESTS",
          httpStatus: 429,
          path,
        },
      },
    },
  };
  return isBatch ? [envelope] : envelope;
}

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyFn?: (c: {
    req: { header: (name: string) => string | undefined; url: string };
    env?: unknown;
  }) => string;
}): MiddlewareHandler {
  const { windowMs, max, keyFn } = opts;

  // Per-client key: real client IP behind proxies (XFF), X-Real-IP, or the
  // raw socket address on direct connections. Never key everyone into one
  // shared "anonymous" bucket — one runaway client must not ban all users.
  const getKey = keyFn || ((c) => {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;
    const env = c.env as
      | { incoming?: { socket?: { remoteAddress?: string } } }
      | undefined;
    return env?.incoming?.socket?.remoteAddress || "anonymous";
  });

  return async (c, next) => {
    const key = getKey(c);
    const now = Date.now();
    const entry = store.get(key);

    if (entry && entry.resetAt > now) {
      if (entry.count >= max) {
        const url = new URL(c.req.url);
        const isBatch = url.searchParams.get("batch") === "1";
        const path = url.pathname.replace(/^.*\/api\/trpc\/?/, "");
        return c.json(tooManyRequestsBody(path, isBatch), 429);
      }
      entry.count++;
    } else {
      store.set(key, { count: 1, resetAt: now + windowMs });
    }

    await next();
  };
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);
