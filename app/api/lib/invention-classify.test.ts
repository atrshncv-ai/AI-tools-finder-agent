import { describe, expect, it } from "vitest";
import { classifyInvention } from "./invention-classify";

describe("classifyInvention", () => {
  it("routes material discovery to inventions and keeps multiple sphere tags", () => {
    const result = classifyInvention("ИИ открыл новый материал и предложил химический синтез");
    expect(result.section).toBe("invention-tools");
    expect(result.sphereTags).toEqual(expect.arrayContaining(["materials", "chemistry"]));
  });

  it("leaves ordinary AI news in the generic section", () => {
    expect(classifyInvention("Новый интерфейс чат-бота").section).toBe("ai-news");
  });
});
