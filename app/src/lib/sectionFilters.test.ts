import { describe, expect, it } from "vitest";
import { getSectionQuery } from "./sectionFilters";

describe("dashboard section queries", () => {
  it("uses the ai-news section for the general feed", () => {
    expect(getSectionQuery("ai-news")).toEqual({ section: "ai-news" });
  });

  it("uses the science section for the science feed", () => {
    expect(getSectionQuery("science")).toEqual({ section: "science" });
  });

  it("uses the invention-tools section for the inventions feed", () => {
    expect(getSectionQuery("invention-tools")).toEqual({ section: "invention-tools" });
  });
});
