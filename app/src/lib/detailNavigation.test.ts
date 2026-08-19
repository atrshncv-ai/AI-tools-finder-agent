import { describe, expect, it } from "vitest";
import { detailReturnPath, withSearchParams } from "./detailNavigation";

describe("detail navigation", () => {
  it("keeps filter query parameters on detail links", () => {
    expect(withSearchParams("/news/42", "categories=robotics&freshness=week")).toBe(
      "/news/42?categories=robotics&freshness=week",
    );
    expect(withSearchParams("/tools/7", "spheres=chemistry&freshness=month")).toBe(
      "/tools/7?spheres=chemistry&freshness=month",
    );
  });

  it("normalizes a location search string for return links", () => {
    expect(detailReturnPath("/science", "?fields=biology&type=update&freshness=day")).toBe(
      "/science?fields=biology&type=update&freshness=day",
    );
    expect(detailReturnPath("/inventions", "")).toBe("/inventions");
  });
});
