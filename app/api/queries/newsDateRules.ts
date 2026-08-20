export const FRESHNESS_HOURS: Record<string, number> = {
  day: 24,
  "3days": 72,
  week: 7 * 24,
  month: 30 * 24,
};

// The dashboard operates in Europe/Moscow (UTC+3) — same zone the digest
// header date and the audience live in. All calendar windows below are
// computed in MSK so "За сутки" means "today's calendar day in MSK".
export const DASHBOARD_TZ_OFFSET_MS = 3 * 3600_000;

/** Start of the current calendar day in MSK, as a UTC instant. */
function startOfMskDay(now: Date): Date {
  const shifted = now.getTime() + DASHBOARD_TZ_OFFSET_MS;
  return new Date(shifted - (shifted % 86_400_000) - DASHBOARD_TZ_OFFSET_MS);
}

/**
 * Calendar-aligned freshness window (MSK):
 * - "day"   → today's calendar day: [00:00 MSK today, now]
 * - "3days" → [today, today-2]  (3 calendar days including today)
 * - "week"  → [today, today-6]  (7 calendar days including today)
 * - "month" → [today, today-29] (30 calendar days including today)
 * - "all"   → unbounded
 *
 * The user rule is strict: if today is 20.08, the "За сутки" filter may only
 * show cards dated 20.08 — never 19.08 (rolling 24h) or anything older.
 */
export function getFreshnessWindow(freshness: string | undefined, now = new Date()) {
  const days: number | undefined =
    freshness === "day"
      ? 1
      : freshness === "3days"
        ? 3
        : freshness === "week"
          ? 7
          : freshness === "month"
            ? 30
            : undefined;

  if (!days) return { from: undefined, to: now };

  const todayStart = startOfMskDay(now);
  const from = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
  return { from, to: now };
}
