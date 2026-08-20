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

  it("uses the legacy title, URL marker, and short description format in every section", () => {
    const text = buildDigest([
      { id: 1, title: "ИИ-новость", originalUrl: "https://example.com/news", source: "rss", isScience: false, section: "ai-news", sphereTags: [], summary: "Краткое описание новости." },
      { id: 2, title: "Научный инструмент", originalUrl: "https://example.com/science", source: "nature", isScience: true, section: "science", sphereTags: [], summary: "Краткое описание научного инструмента." },
      { id: 3, title: "Инструмент для изобретений", originalUrl: "https://example.com/invention", source: "catalog", isScience: false, section: "invention-tools", sphereTags: [], summary: "Краткое описание инструмента для изобретений." },
    ]);

    expect(text).toContain("🛠 *ИИ-новости* — 1");
    expect(text).toContain("🔬 *ИИ для науки* — 1");
    expect(text).toContain("🧪 *Инструменты для изобретений* — 1");
    expect(text).toContain("▫️ ИИ-новость (@url:`https://example.com/news`) — Краткое описание новости.");
    expect(text).toContain("▫️ Научный инструмент (@url:`https://example.com/science`) — Краткое описание научного инструмента.");
    expect(text).toContain("▫️ Инструмент для изобретений (@url:`https://example.com/invention`) — Краткое описание инструмента для изобретений.");
    expect(text).not.toContain("[ИИ-новость](");
  });
});

describe("digest archive block", () => {
  it("keeps archive items out of section counters and shows them separately", () => {
    const fresh = [
      { id: 1, title: "Свежая ИИ-новость", originalUrl: "https://example.com/a", source: "hn", isScience: false, section: "ai-news", sphereTags: [] },
    ];
    const archive = [
      { id: 2, title: "Архивная статья про CRISPR", originalUrl: "https://example.com/b", source: "nature", isScience: true, section: "science", sphereTags: [] },
    ];
    const text = buildDigest(fresh, archive);
    expect(text).toContain("опубликовано: *1*");
    expect(text).toContain("Из архива");
    expect(text).toContain("Архивная статья про CRISPR");
    expect(text).toContain("в счётчики суток не входят");
    // Archive science article must NOT inflate the science section header
    expect(text).not.toContain("ИИ для науки — 1");
  });

  it("uses the same title (@url:`...`) format as sections (not bare [title](url))", () => {
    const text = buildDigest([], [
      { id: 2, title: "Архивная статья", originalUrl: "https://example.com/b", source: "nature", isScience: true, section: "science", sphereTags: [], summary: "Описание архивной статьи." },
    ]);
    expect(text).toContain("▫️ Архивная статья (@url:`https://example.com/b`) — Описание архивной статьи.");
    expect(text).not.toContain("[Архивная статья](");
  });
});

describe("digest markdown safety (Telegram parse_mode=Markdown)", () => {
  const tricky = [
    { id: 1, title: "Звёздочки *в* _заголовке_ и [скобки]", originalUrl: "https://example.com/a", source: "hn", isScience: false, section: "ai-news", sphereTags: ["ai"], summary: "Саммари с `бэктиками` и *звёздочкой*" },
    { id: 2, title: "Обычный заголовок", originalUrl: "https://example.com/b", source: null, isScience: true, section: "science", sphereTags: [], summary: null },
  ];

  it("header bold is closed (regression: Telegram 400 can't find end of entity)", () => {
    const text = buildDigest(tricky);
    expect(text).toContain("*Утренний дайджест научного агента*");
  });

  it("all legacy-Markdown entities are balanced after escaping", () => {
    const text = buildDigest(tricky, [
      { id: 3, title: "Архив [с _пометками*]", originalUrl: "https://example.com/c", source: "nature", isScience: true, section: "science", sphereTags: [] },
    ]);
    // Walk the text once: \X is a literal X; emphasis chars must pair.
    let stars = 0, underscores = 0, backticks = 0, brackets = 0;
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "*") stars++;
      else if (c === "_") underscores++;
      else if (c === "`") backticks++;
      else if (c === "[") brackets++;
      else if (c === "]") brackets--;
      i++;
    }
    expect(stars % 2).toBe(0);
    expect(underscores % 2).toBe(0);
    expect(backticks % 2).toBe(0);
    expect(brackets).toBe(0);
  });

  it("URLs with parentheses and query strings stay balanced (regression: Telegram 400 can't parse entities)", () => {
    const text = buildDigest([
      { id: 1, title: "Статья", originalUrl: "https://en.wikipedia.org/wiki/Foo_(bar)", source: "nature", isScience: false, section: "ai-news", sphereTags: [], summary: "Обычное описание." },
      { id: 2, title: "Ещё", originalUrl: "https://example.com/a?x=1&y=2", source: null, isScience: true, section: "science", sphereTags: [], summary: null },
    ]);
    expect(text).toContain("(@url:`https://en.wikipedia.org/wiki/Foo_(bar)`)");
    expect(text).toContain("(@url:`https://example.com/a?x=1&y=2`)");
    // No unescaped square brackets in the whole text (would break the link parser)
    expect(text).not.toContain("[");
  });
});