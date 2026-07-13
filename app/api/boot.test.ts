import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("./queries/connection", () => ({
  getDb: vi.fn(),
}));

vi.mock("./ai/zenClient", () => ({
  checkZenConnection: vi.fn(),
}));

import { getDb } from "./queries/connection";
import { checkZenConnection } from "./ai/zenClient";

const mockGetDb = vi.mocked(getDb);
const mockCheckZen = vi.mocked(checkZenConnection);

function createHealthApp() {
  const app = new Hono();
  app.get("/health", async (c) => {
    const checks: Record<string, string> = {};
    let status: "ok" | "degraded" | "error" = "ok";

    try {
      const db = mockGetDb();
      await db.execute("SELECT 1");
      checks.database = "ok";
    } catch {
      checks.database = "error";
      status = "error";
    }

    const zenOk = await mockCheckZen();
    checks.zen = zenOk ? "ok" : "unavailable";
    if (!zenOk && status === "ok") status = "degraded";

    return c.json({ status, checks, ts: Date.now() }, status === "error" ? 503 : 200);
  });
  return app;
}

describe("health endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when all services healthy", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetDb.mockReturnValue({ execute: vi.fn().mockResolvedValue(null) } as any);
    mockCheckZen.mockResolvedValue(true);

    const app = createHealthApp();
    const res = await app.request("/health");
    const body = await res.json() as { status: string; checks: Record<string, string>; ts: number };

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.zen).toBe("ok");
    expect(body.ts).toBeDefined();
  });

  it("returns degraded when Zen API unavailable", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetDb.mockReturnValue({ execute: vi.fn().mockResolvedValue(null) } as any);
    mockCheckZen.mockResolvedValue(false);

    const app = createHealthApp();
    const res = await app.request("/health");
    const body = await res.json() as { status: string; checks: Record<string, string> };

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.zen).toBe("unavailable");
  });

  it("returns 503 when database fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetDb.mockReturnValue({ execute: vi.fn().mockRejectedValue(new Error("DB down")) } as any);
    mockCheckZen.mockResolvedValue(true);

    const app = createHealthApp();
    const res = await app.request("/health");
    const body = await res.json() as { status: string; checks: Record<string, string> };

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.database).toBe("error");
  });
});
