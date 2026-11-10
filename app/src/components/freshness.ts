export type FreshnessKey = "all" | "day" | "3days" | "week" | "month";

export const FRESHNESS_OPTIONS: { key: FreshnessKey; name: string }[] = [
  { key: "all", name: "Всё время" },
  { key: "day", name: "За сутки" },
  { key: "3days", name: "3 дня" },
  { key: "week", name: "Неделя" },
  { key: "month", name: "Месяц" },
];

export function freshnessHours(key: FreshnessKey): number | null {
  switch (key) {
    case "day": return 24;
    case "3days": return 72;
    case "week": return 7 * 24;
    case "month": return 30 * 24;
    default: return null;
  }
}
