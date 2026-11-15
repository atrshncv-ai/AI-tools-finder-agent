import { sql, type SQL } from "drizzle-orm";
import { news } from "@db/schema";

export const FRESHNESS_HOURS: Record<string, number> = {
  day: 24,
  "3days": 72,
  week: 7 * 24,
  month: 30 * 24,
};

export function getFreshnessWindow(freshness: string | undefined, now = new Date()) {
  const hours = freshness && freshness !== "all" ? FRESHNESS_HOURS[freshness] : undefined;
  return {
    from: hours ? new Date(now.getTime() - hours * 3600_000) : undefined,
    to: now,
  };
}

/**
 * Immutable publication instant of a news row: `platformPublishedAt` is written
 * once on release, `updatedAt` only covers rows published before that column
 * existed.
 */
export function publishedAtSql() {
  return sql`coalesce(${news.platformPublishedAt}, ${news.updatedAt})`;
}

/**
 * A JS instant as a bound parameter with an explicit `timestamptz` cast.
 *
 * The cast is the point: the timestamp columns are `timestamp with time zone`
 * since migration 0012, and an untyped parameter would be resolved by the
 * session `TimeZone` if the column ever regressed to a naive type — the exact
 * 3-hour shift the migration removes. Passing a `Date` and formatting it here
 * keeps ISO parsing in one place instead of at every call site.
 */
export function instantParam(value: Date): SQL {
  return sql`${value.toISOString()}::timestamptz`;
}
