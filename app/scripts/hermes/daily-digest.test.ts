import { describe, expect, it } from "vitest";
import { buildDigest, buildEmptyDigest, isPaymentReminderDay, paymentReminderText, splitTelegramText } from "./daily-digest";
import { formatHealthLine, type PipelineStats } from "./pipeline-health";

const healthyStats: PipelineStats = {
  collected: 210, evaluated: 180, published: 46, processingErrors: 4,
  feedsTotal: 13, feedsFailing: 0, failingFeedNames: [],
  zenPoolSize: 4, zenCoolingKeys: 1, zenStateUpdatedAt: null,
  lastPublishedAt: new Date(Date.now() - 3600_000),
};

describe("splitTelegramText", () => {
  it("splits long digests at line boundaries without truncating", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const parts = splitTelegramText(text, 30);
    expect(parts.every((part) => part.length <= 30)).toBe(true);
    expect(parts.join("\n")).toBe(text);
  });
});

describe("empty-day heartbeat", () => {
  it("produces an explicit no-news message so silence always means failure", () => {
    const text = buildEmptyDigest();
    expect(text).toContain("новых публикаций нет");
    expect(text).toContain("Утренний дайджест");
  });
});

describe("health line", () => {
  it("shows pipeline counters without warnings when healthy", () => {
    const line = formatHealthLine(healthyStats);
    expect(line).toContain("⚙️ Конвейер");
    expect(line).toContain("собрано 210");
    expect(line).toContain("опубликовано 46");
    expect(line).toContain("фиды 13/13");
    expect(line).toContain("Zen 3/4");
    expect(line).not.toContain("⚠️");
  });

  it("warns on zero publications, failing feeds and exhausted key pool", () => {
    const line = formatHealthLine({
      ...healthyStats,
      published: 0,
      feedsFailing: 1,
      failingFeedNames: ["science"],
      zenCoolingKeys: 4,
      lastPublishedAt: new Date(Date.now() - 48 * 3600_000),
    });
    expect(line).toContain("⚠️");
    expect(line).toContain("нет публикаций");
    expect(line).toContain("science");
    expect(line).toContain("Zen 0/4");
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
  it("places the health line under the counter when provided", () => {
    const text = buildDigest([
      { id: 1, title: "Новость", originalUrl: "https://example.com/n", source: "rss", isScience: false, section: "ai-news", sphereTags: [] },
    ], formatHealthLine(healthyStats));
    const counterIdx = text.indexOf("опубликовано: *1*");
    const healthIdx = text.indexOf("⚙️ Конвейер");
    expect(healthIdx).toBeGreaterThan(counterIdx);
    expect(text).toContain("ИИ-новости");
  });

  it("uses exactly the three fixed product sections", () => {
    const text = buildDigest([
      { id: 1, title: "Видео", originalUrl: "https://example.com/v", source: "youtube-demo", isScience: false, section: "ai-news", sphereTags: [] },
      { id: 2, title: "Материал", originalUrl: "https://example.com/m", source: "nature", isScience: true, section: "invention-tools", sphereTags: ["materials"] },
    ]);
    expect(text).toContain("ИИ-новости");
    expect(text).toContain("Инструменты для изобретений");
    expect(text).not.toContain("Видео с YouTube");
  });

  it("uses tappable Telegram links and short descriptions in every section", () => {
    const text = buildDigest([
      { id: 1, title: "ИИ-новость", originalUrl: "https://example.com/news", source: "rss", isScience: false, section: "ai-news", sphereTags: [], summary: "Краткое описание новости." },
      { id: 2, title: "Научный инструмент", originalUrl: "https://example.com/science", source: "nature", isScience: true, section: "science", sphereTags: [], summary: "Краткое описание научного инструмента." },
      { id: 3, title: "Инструмент для изобретений", originalUrl: "https://example.com/invention", source: "catalog", isScience: false, section: "invention-tools", sphereTags: [], summary: "Краткое описание инструмента для изобретений." },
    ]);

    expect(text).toContain("🛠 *ИИ-новости* — 1");
    expect(text).toContain("🔬 *ИИ для науки* — 1");
    expect(text).toContain("🧪 *Инструменты для изобретений* — 1");
    expect(text).toContain("▫️ [ИИ-новость](https://example.com/news) — Краткое описание новости.");
    expect(text).toContain("▫️ [Научный инструмент](https://example.com/science) — Краткое описание научного инструмента.");
    expect(text).toContain("▫️ [Инструмент для изобретений](https://example.com/invention) — Краткое описание инструмента для изобретений.");
  });
});

describe("digest archive handling", () => {
  it("does not include archive items in the digest", () => {
    const fresh = [
      { id: 1, title: "Свежая ИИ-новость", originalUrl: "https://example.com/a", source: "hn", isScience: false, section: "ai-news", sphereTags: [] },
    ];
    const text = buildDigest(fresh);
    expect(text).toContain("опубликовано: *1*");
    expect(text).not.toContain("Из архива");
    expect(text).not.toContain("Архивная статья про CRISPR");
    expect(text).not.toContain("ИИ для науки — 1");
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
    const text = buildDigest(tricky);
    // Walk the text once: \X is a literal X; emphasis chars must pair; every
    // unescaped "]" must close a [text](url) link — otherwise Telegram 400s.
    let depth = 0, stars = 0, underscores = 0, backticks = 0;
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "*") stars++;
      else if (c === "_") underscores++;
      else if (c === "`") backticks++;
      else if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        expect(text[i + 1]).toBe("("); // link URL must open right after
        const close = text.indexOf(")", i + 2);
        expect(close).toBeGreaterThan(0);
        i = close;
      }
      i++;
    }
    expect(depth).toBe(0);
    expect(stars % 2).toBe(0);
    expect(underscores % 2).toBe(0);
    expect(backticks % 2).toBe(0);
  });
});
