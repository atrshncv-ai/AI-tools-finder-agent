import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  FRESHNESS_HOURS,
  getFreshnessWindow,
  instantParam,
  newsFeedOrder,
  platformPublishedAtSql,
} from "./newsDateRules";

describe("news freshness windows", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");

  it.each([
    ["day", 24],
    ["3days", 72],
    ["week", 168],
    ["month", 720],
  ])("uses platformPublishedAt for the %s rolling window", (key, hours) => {
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

  it("renders the card publication instant as a plain column", () => {
    const query = dialect.sqlToQuery(platformPublishedAtSql());
    expect(query.sql).toBe('"news"."platformPublishedAt"');
    expect(query.params).toEqual([]);
  });

  it("orders the feed by card publication, newest first, then by id", () => {
    const query = dialect.sqlToQuery(sql.join(newsFeedOrder(), sql`, `));
    expect(query.sql).toBe('"news"."platformPublishedAt" desc, "news"."id" desc');
  });

  it("binds the window edge as a parameter with an explicit timestamptz cast", () => {
    const query = dialect.sqlToQuery(sql`${platformPublishedAtSql()} >= ${instantParam(from)}`);
    expect(query.sql).toBe('"news"."platformPublishedAt" >= $1::timestamptz');
    expect(query.params).toEqual(["2026-08-18T12:00:00.000Z"]);
    // The instant travels as a value, never spliced into the SQL text.
    expect(query.sql).not.toContain("2026-08-18");
  });
});
