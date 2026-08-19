import { describe, expect, it } from "vitest";
import { FRESHNESS_HOURS, getFreshnessWindow } from "./newsDateRules";

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
