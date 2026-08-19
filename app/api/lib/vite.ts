import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  // Vite emits content-hashed filenames under /assets — safe to cache
  // immutably for a year. Registered before serveStatic so the header lands
  // on the finalized response.
  app.use("/assets/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  });

  // Every HTML response (directory index from serveStatic and the SPA
  // fallback below) must revalidate, otherwise Telegram's in-app browser and
  // mobile Safari keep serving a stale bundle after a deploy.
  app.use("*", async (c, next) => {
    await next();
    const type = c.res.headers.get("content-type") || "";
    if (type.includes("text/html")) {
      c.res.headers.set("Cache-Control", "no-cache");
    }
  });

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
