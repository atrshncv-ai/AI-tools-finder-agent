/**
 * news.test.ts — the date every news list is ordered and filtered by.
 *
 * Why: `publishedAt` is the source's release date and only matters for the
 * collection window. The dashboard date is when the card itself was published
 * (`platformPublishedAt`), so ordering and the freshness filter must use it —
 * never the source date, and never the mutable `updatedAt` fallback.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const { fakeDb, captured } = vi.hoisted(() => {
  const captured: { where?: any; order: any[] } = { order: [] };

  function chain(kind: "items" | "count") {
    const c: any = {
      from: () => c,
      leftJoin: () => c,
      where: (where: any) => {
        captured.where = where;
        return c;
      },
      orderBy: (...args: any[]) => {
        captured.order = args;
        return c;
      },
      limit: () => c,
      offset: () => c,
      then: (resolve: any, reject: any) =>
        Promise.resolve(kind === "items" ? [] : [{ count: 0 }]).then(resolve, reject),
    };
    return c;
  }

  return {
    captured,
    fakeDb: {
      select: (fields: any) =>
        chain(fields && typeof fields === "object" && "count" in fields ? "count" : "items"),
    },
  };
});

vi.mock("./connection", () => ({ getDb: () => fakeDb }));

import { findAllNews } from "./news";

const dialect = new PgDialect();

function rendered() {
  return {
    where: dialect.sqlToQuery(captured.where),
    order: dialect.sqlToQuery(sql.join(captured.order, sql`, `)),
  };
}

describe("news feed: dates", () => {
  afterEach(() => {
    vi.useRealTimers();
    captured.order = [];
    captured.where = undefined;
  });

  it("orders by platform publication, newest first, then by id", async () => {
    await findAllNews({});
    expect(rendered().order.sql).toBe('"news"."platformPublishedAt" desc, "news"."id" desc');
  });

  it("counts the freshness window from platformPublication, not the source date", async () => {
    await findAllNews({ freshness: "day" });
    const { where } = rendered();
    expect(where.sql).toContain('"news"."platformPublishedAt" >=');
    expect(where.sql).toContain('"news"."platformPublishedAt" <=');
    expect(where.sql).not.toContain('"news"."publishedAt"');
    expect(where.sql).not.toContain("updatedAt");
  });

  it("binds the day window as instants around now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00.000Z"));
    await findAllNews({ freshness: "day" });
    const { where } = rendered();
    expect(where.params).toContain("2026-11-14T12:00:00.000Z");
    expect(where.params).toContain("2026-11-15T12:00:00.000Z");
  });

  it("keeps the open-ended window bounded at now without a lower edge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00.000Z"));
    await findAllNews({ freshness: "all" });
    const { where } = rendered();
    expect(where.sql).not.toContain(">=");
    expect(where.params).toContain("2026-11-15T12:00:00.000Z");
  });
});
