import { desc, sql, type SQL } from "drizzle-orm";
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
 * Immutable instant the card itself was published on this platform: the date
 * the dashboard shows, the date feed ordering uses and the date freshness
 * windows count from. The source's own `publishedAt` only feeds the collection
 * window and is never displayed.
 */
export function platformPublishedAtSql() {
  return sql`${news.platformPublishedAt}`;
}

/** Newest card publication first; `id` keeps rows with the same instant stable. */
export function newsFeedOrder() {
  return [desc(news.platformPublishedAt), desc(news.id)];
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
