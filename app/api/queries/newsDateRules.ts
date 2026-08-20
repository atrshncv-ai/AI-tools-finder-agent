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
