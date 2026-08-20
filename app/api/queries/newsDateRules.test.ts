import { describe, expect, it } from "vitest";
import { FRESHNESS_HOURS, getFreshnessWindow } from "./newsDateRules";

describe("news freshness windows (calendar-aligned, MSK)", () => {
  // 2026-08-20 13:45 UTC = 16:45 MSK
  const now = new Date("2026-08-20T13:45:00.000Z");
  const mskDayStart = new Date("2026-08-19T21:00:00.000Z"); // 00:00 MSK 20.08

  it("day window starts at 00:00 MSK today (strict calendar day)", () => {
    const { from, to } = getFreshnessWindow("day", now);
    expect(from).toEqual(mskDayStart);
    expect(to).toEqual(now);
  });

  it("a card dated 23:59:59 MSK 19.08 never enters the day filter on 20.08", () => {
    const { from } = getFreshnessWindow("day", now);
    const cardDated = new Date("2026-08-19T20:59:59.000Z");
    expect(cardDated.getTime() < from!.getTime()).toBe(true);
  });

  it.each([
    ["3days", 3],
    ["week", 7],
    ["month", 30],
  ])("%s window spans %s calendar days including today", (key, days) => {
    const { from } = getFreshnessWindow(key, now);
    const expectedFrom = new Date(mskDayStart.getTime() - (days - 1) * 86_400_000);
    expect(from!.getTime()).toBe(expectedFrom.getTime());
  });

  it("keeps the all window unbounded", () => {
    expect(getFreshnessWindow("all", now)).toEqual({ from: undefined, to: now });
  });

  it("FRESHNESS_HOURS still documents the legacy rolling sizes", () => {
    expect(FRESHNESS_HOURS.day).toBe(24);
    expect(FRESHNESS_HOURS.month).toBe(720);
  });
});
