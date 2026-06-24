import type { MiddlewareHandler } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyFn?: (c: { req: { header: (name: string) => string | undefined } }) => string;
}): MiddlewareHandler {
  const { windowMs, max, keyFn } = opts;

  const getKey = keyFn || ((c) => {
    return c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "anonymous";
  });

  return async (c, next) => {
    const key = getKey(c);
    const now = Date.now();
    const entry = store.get(key);

    if (entry && entry.resetAt > now) {
      if (entry.count >= max) {
        return c.json({ error: "Too many requests" }, 429);
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
