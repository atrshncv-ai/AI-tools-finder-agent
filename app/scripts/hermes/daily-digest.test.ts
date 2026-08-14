import { describe, expect, it } from "vitest";
import { splitTelegramText } from "./daily-digest";

describe("splitTelegramText", () => {
  it("splits long digests at line boundaries without truncating", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const parts = splitTelegramText(text, 30);
    expect(parts.every((part) => part.length <= 30)).toBe(true);
    expect(parts.join("\n")).toBe(text);
  });
});
