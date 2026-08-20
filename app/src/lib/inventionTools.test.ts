import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterInventionToolsByFreshness,
  filterInventionToolsBySpheres,
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
  it("renders news and catalog tools as one card list", () => {
    const page = readFileSync(new URL("../pages/InventionTools.tsx", import.meta.url), "utf8");
    expect(page).toContain("news.list");
    expect(page).toContain("newsData");
    expect(page).toContain("NewsCard");
    expect(page).toContain('kind: "tool"');
  });

  it("uses only catalog records and keeps equal freshness deterministic", () => {
    const records = [
      tool(2, "Second", "2026-08-20T10:00:00Z", ["chemistry"]),
      tool(1, "First", "2026-08-20T10:00:00Z", ["biology"]),
    ];
    expect(sortInventionTools(records).map(({ id }) => id)).toEqual([2, 1]);
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

  it("applies freshness to catalog verification dates", () => {
    const records = [
      tool(1, "Fresh", "2026-08-20T00:00:00Z", ["chemistry"]),
      tool(2, "Old", "2026-08-19T00:00:00Z", ["chemistry"]),
    ];
    expect(filterInventionToolsByFreshness(records, "day", now).map(({ name }) => name)).toEqual(["Fresh"]);
  });

  it("uses the original catalog date, not the latest verification date", () => {
    const record = {
      ...tool(1, "Stable", "2026-08-20T00:00:00Z", ["chemistry"]),
      createdAt: "2026-08-14T00:00:00Z",
      lastVerifiedAt: "2026-08-20T00:00:00Z",
    };
    expect(record.createdAt).toBe("2026-08-14T00:00:00Z");
    expect(new Date(record.createdAt).toLocaleDateString("ru-RU")).toBe("14.08.2026");
  });
});
