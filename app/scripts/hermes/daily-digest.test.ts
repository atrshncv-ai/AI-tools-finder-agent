import { describe, expect, it } from "vitest";
import { buildDigest, isPaymentReminderDay, paymentReminderText, splitTelegramText } from "./daily-digest";

describe("splitTelegramText", () => {
  it("splits long digests at line boundaries without truncating", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const parts = splitTelegramText(text, 30);
    expect(parts.every((part) => part.length <= 30)).toBe(true);
    expect(parts.join("\n")).toBe(text);
  });
});

describe("payment reminders", () => {
  it("fires 88 days before due date and every 30 days afterwards", () => {
    expect(isPaymentReminderDay(new Date("2026-08-14T12:00:00Z"), "2026-11-10")).toBe(true);
    expect(isPaymentReminderDay(new Date("2026-12-10T12:00:00Z"), "2026-11-10")).toBe(true);
    expect(isPaymentReminderDay(new Date("2026-12-11T12:00:00Z"), "2026-11-10")).toBe(false);
    expect(paymentReminderText("2026-11-10")).toContain("2026-11-10");
  });
});

describe("digest sections", () => {
  it("uses exactly the three fixed product sections", () => {
    const text = buildDigest([
      { id: 1, title: "Видео", originalUrl: "https://example.com/v", source: "youtube-demo", isScience: false, section: "ai-news", sphereTags: [] },
      { id: 2, title: "Материал", originalUrl: "https://example.com/m", source: "nature", isScience: true, section: "invention-tools", sphereTags: ["materials"] },
    ]);
    expect(text).toContain("ИИ-новости");
    expect(text).toContain("Инструменты для изобретений");
    expect(text).not.toContain("Видео с YouTube");
  });
});
