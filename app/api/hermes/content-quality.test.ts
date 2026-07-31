import { describe, expect, it } from "vitest";
import { isUnusableExtractedContent } from "../../scripts/hermes/content-quality";

describe("extracted content quality", () => {
  it("accepts a verified YouTube transcript even when spoken refrains repeat", () => {
    const transcript = `${"Welcome back to the channel. ".repeat(5)}${"A".repeat(100)}`;

    expect(isUnusableExtractedContent(transcript, "youtube-transcript")).toBe(false);
  });

  it("still rejects repetitive HTML extraction artifacts", () => {
    const article = `${"Cookie settings. ".repeat(5)}${"A".repeat(100)}`;

    expect(isUnusableExtractedContent(article, "web-article")).toBe(true);
  });
});
