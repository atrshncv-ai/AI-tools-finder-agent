import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Hermes model configuration", () => {
  it("uses the economical DeepSeek V4 Flash free model by default", () => {
    const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

    expect(envExample).toContain("ZEN_MODEL=deepseek-v4-flash-free");
  });
});
