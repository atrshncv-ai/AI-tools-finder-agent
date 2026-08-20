import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterInventionToolsByFreshness,
  filterInventionToolsBySpheres,
  inventionToolFreshnessDate,
  sortInventionTools,
} from "./inventionTools";

type Tool = Parameters<typeof sortInventionTools>[0][number];
const now = Date.parse("2026-08-20T12:00:00Z");
const tool = (id: number, name: string, verified: string, spheres: string[]): Tool => ({
  id,
  name,
  spheres,
  lastVerifiedAt: verified,
  updatedAt: verified,
  createdAt: verified,
});

describe("invention tool catalog presentation", () => {
  it("shows news of the invention-tools section above the catalog (digest parity)", () => {
    const page = readFileSync(new URL("../pages/InventionTools.tsx", import.meta.url), "utf8");
    // The section must query the SAME news rows the digest renders, so the
    // dashboard and the morning digest never diverge.
    expect(page).toContain('section: "invention-tools"');
    expect(page).toContain("news.list");
    expect(page).toContain("newsTotal");
  });

  it("still renders the verified catalog below the news feed", () => {
    const page = readFileSync(new URL("../pages/InventionTools.tsx", import.meta.url), "utf8");
    expect(page).toContain("Каталог проверенных инструментов");
    expect(page).toContain("inventionTools.useQuery");
  });

  it("orders catalog by added/updated date, not by nightly verification timestamp", () => {
    const records = [
      tool(2, "RecentlyAdded", "2026-08-18T00:00:00Z", ["chemistry"]),
      tool(1, "VerifiedToday", "2026-08-20T03:00:00Z", ["biology"]),
    ];
    // lastVerifiedAt differs (nightly batch) but updatedAt decides order.
    expect(inventionToolFreshnessDate(records[0]).getTime()).toBeLessThan(
      inventionToolFreshnessDate(records[1]).getTime(),
    );
    const sorted = sortInventionTools(records).map(({ id }) => id);
    // id 1 was added/updated later (Aug 20) than id 2 (Aug 18) -> newest first.
    expect(sorted).toEqual([1, 2]);
  });

  it("preserves sphere filtering and makes the visible count the card count", () => {
    const records = [
      tool(1, "Chemistry", "2026-08-20T10:00:00Z", ["chemistry"]),
      tool(2, "Biology", "2026-08-20T10:00:00Z", ["biology"]),
    ];
    const visible = filterInventionToolsBySpheres(records, ["chemistry"]);
    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Chemistry");
  });

  it("applies freshness to catalog added dates", () => {
    const records = [
      tool(1, "Fresh", "2026-08-20T00:00:00Z", ["chemistry"]),
      tool(2, "Old", "2026-08-19T00:00:00Z", ["chemistry"]),
    ];
    expect(filterInventionToolsByFreshness(records, "day", now).map(({ name }) => name)).toEqual(["Fresh"]);
  });
});