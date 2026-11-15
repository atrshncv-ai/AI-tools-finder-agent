/**
 * The only date the dashboard shows: when the card itself was published here,
 * in Moscow time, as «15 ноября, 17:42». The source's `publishedAt` stays in
 * the database for the collection window and is never rendered.
 */
export const DASHBOARD_TIME_ZONE = "Europe/Moscow";

const DAY_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: DASHBOARD_TIME_ZONE,
  day: "numeric",
  month: "long",
});

const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: DASHBOARD_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Formats a card publication instant, or returns `null` when the card has not
 * been published yet — callers then omit the date entirely instead of falling
 * back to another column.
 */
export function formatPlatformPublishedAt(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${DAY_FORMAT.format(date)}, ${TIME_FORMAT.format(date)}`;
}
