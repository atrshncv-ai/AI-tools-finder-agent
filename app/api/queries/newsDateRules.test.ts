import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { FRESHNESS_HOURS, getFreshnessWindow, instantParam, publishedAtSql } from "./newsDateRules";

describe("news freshness windows", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");

  it.each([
    ["day", 24],
    ["3days", 72],
    ["week", 168],
    ["month", 720],
  ])("uses updatedAt for the %s rolling window", (key, hours) => {
    expect(FRESHNESS_HOURS[key]).toBe(hours);
    expect(getFreshnessWindow(key, now).from).toEqual(
      new Date(now.getTime() - hours * 3600_000),
    );
    expect(getFreshnessWindow(key, now).to).toEqual(now);
  });

  it("keeps the all window bounded at now to exclude future updates", () => {
    expect(getFreshnessWindow("all", now)).toEqual({ from: undefined, to: now });
  });
});

describe("timestamp comparisons", () => {
  const dialect = new PgDialect();
  const from = new Date("2026-08-18T12:00:00.000Z");

  it("renders the publication instant as a coalesce over the news columns", () => {
    const query = dialect.sqlToQuery(publishedAtSql());
    expect(query.sql).toBe('coalesce("news"."platformPublishedAt", "news"."updatedAt")');
    expect(query.params).toEqual([]);
  });

  it("binds the window edge as a parameter with an explicit timestamptz cast", () => {
    const query = dialect.sqlToQuery(sql`${publishedAtSql()} >= ${instantParam(from)}`);
    expect(query.sql).toBe(
      'coalesce("news"."platformPublishedAt", "news"."updatedAt") >= $1::timestamptz',
    );
    expect(query.params).toEqual(["2026-08-18T12:00:00.000Z"]);
    // The instant travels as a value, never spliced into the SQL text.
    expect(query.sql).not.toContain("2026-08-18");
  });
});
