import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler, createOAuthLoginHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { startScheduler, stopScheduler } from "./scheduler";
import { rateLimit } from "./lib/rateLimit";
import { logger } from "./lib/logger";
import { getDb, closeDb } from "./queries/connection";
import { checkLmStudioConnection } from "./ai/client";
import { initAgentState, initSourceHealthState } from "./agent/state";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use("*", cors({
  origin: env.isProduction ? env.corsOrigin : "*",
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.use("/api/trpc/*", rateLimit({
  windowMs: 60 * 1000,
  max: 100,
}));

app.get(Paths.oauthLogin, createOAuthLoginHandler());
app.get(Paths.oauthCallback, createOAuthCallbackHandler());

app.get("/health", async (c) => {
  const checks: Record<string, string> = {};
  let status: "ok" | "degraded" | "error" = "ok";

  try {
    const db = getDb();
    await db.execute("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "error";
    status = "error";
  }

  const lmStudioOk = await checkLmStudioConnection();
  checks.lmStudio = lmStudioOk ? "ok" : "unavailable";
  if (!lmStudioOk && status === "ok") status = "degraded";

  return c.json({ status, checks, ts: Date.now() }, status === "error" ? 503 : 200);
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  // Load persisted agent/source state before starting the scheduler
  await initAgentState(["parse-agent", "summarize-agent", "translate-agent", "deploy-agent"]);
  await initSourceHealthState();

  startScheduler();

  const server = serve({ fetch: app.fetch, port: env.port }, () => {
    logger.info("Server started", { port: env.port, env: process.env.NODE_ENV });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    stopScheduler();
    server.close?.();
    await closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
