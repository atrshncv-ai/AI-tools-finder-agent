import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "./rateLimit";

function createTestApp(opts: { windowMs: number; max: number }) {
  const app = new Hono();
  app.use("*", rateLimit(opts));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  it("allows requests within limit", async () => {
    const app = createTestApp({ windowMs: 60000, max: 3 });
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("blocks requests over limit", async () => {
    const app = createTestApp({ windowMs: 60000, max: 2 });
    await app.request("/test");
    await app.request("/test");
    const res = await app.request("/test");
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Too many requests");
  });

  it("uses custom keyFn", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        windowMs: 60000,
        max: 1,
        keyFn: () => "custom-key",
      })
    );
    app.get("/test", (c) => c.json({ ok: true }));

    await app.request("/test");
    const res = await app.request("/test");
    expect(res.status).toBe(429);
  });

  it("different keys have separate limits", async () => {
    const app = new Hono();
    let callCount = 0;
    app.use(
      "*",
      rateLimit({
        windowMs: 60000,
        max: 1,
        keyFn: () => {
          callCount++;
          return callCount <= 2 ? "key-a" : "key-b";
        },
      })
    );
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request("/test"); // key-a, count=1
    expect(res1.status).toBe(200);
    const res2 = await app.request("/test"); // key-a, count=2 → blocked
    expect(res2.status).toBe(429);
    const res3 = await app.request("/test"); // key-b, count=1
    expect(res3.status).toBe(200);
  });
});
