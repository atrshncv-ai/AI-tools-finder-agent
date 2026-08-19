import { describe, expect, it } from "vitest";
import { validateInventionTool } from "./inventionToolQuality";

const valid = {
  slug: "mattergen",
  name: "MatterGen",
  kind: "materials-generation",
  spheres: ["materials"],
  description: "Generates candidate materials for scientific discovery.",
  officialUrl: "https://example.org/mattergen",
} as const;

describe("invention tool seed quality", () => {
  it("accepts an AI scientific invention tool with an official URL", () => {
    expect(() => validateInventionTool(valid)).not.toThrow();
  });

  it.each([
    ["missing description", { description: "" }],
    ["missing scientific sphere", { spheres: [] }],
    ["non-http official URL", { officialUrl: "javascript:alert(1)" }],
  ])("rejects %s", (_, override) => {
    expect(() => validateInventionTool({ ...valid, ...override })).toThrow(/Invalid invention tool/);
  });
});
