import { describe, expect, it } from "vitest";
import {
  buildClientDigest,
  buildEmptyClientDigest,
  buildOwnerReport,
  buildPreviewDigest,
  digestMaxPerSection,
  DIGEST_MAX_PER_SECTION_MAX,
  DIGEST_MAX_PER_SECTION_MIN,
  fitSummary,
  formatItem,
  MAX_ITEMS_PER_SECTION,
  PREVIEW_FOOTER,
  PREVIEW_HEADER,
  resolveRecipients,
  splitTelegramText,
  SUMMARY_MAX_CHARS,
  type DigestItem,
} from "./digest-format";
import {
  DIGEST_DASHBOARD_URL,
  DIGEST_DATE,
  GOLDEN_CLIENT_DIGEST,
  GOLDEN_CYCLE_STATS,
  GOLDEN_HEALTH_LINE,
  GOLDEN_ITEMS,
  GOLDEN_OWNER_REPORT,
  LONG_SUMMARY,
} from "./__fixtures__/digest-fixture";

const opts = { date: DIGEST_DATE, dashboardUrl: DIGEST_DASHBOARD_URL };

describe("client digest form (R21)", () => {
  it("matches the approved reference message exactly", () => {
    expect(buildClientDigest(GOLDEN_ITEMS, opts)).toBe(GOLDEN_CLIENT_DIGEST);
  });

  it("keeps the three product sections in the agreed order regardless of input order", () => {
    const shuffled = [GOLDEN_ITEMS[14], GOLDEN_ITEMS[1], GOLDEN_ITEMS[13]];
    const text = buildClientDigest(shuffled, opts);
    const aiNews = text.indexOf("🛠 *ИИ-новости*");
    const science = text.indexOf("🔬 *ИИ для науки*");
    const invention = text.indexOf("🧪 *Инструменты для изобретений*");
    expect(aiNews).toBeGreaterThan(-1);
    expect(science).toBeGreaterThan(aiNews);
    expect(invention).toBeGreaterThan(science);
  });

  it("omits a section that has no materials instead of printing a zero header", () => {
    const text = buildClientDigest([GOLDEN_ITEMS[0]], opts);
    expect(text).toContain("🛠 *ИИ-новости* — 1");
    expect(text).not.toContain("🔬");
    expect(text).not.toContain("🧪");
  });

  it("ends with the dashboard address and never with a service line", () => {
    const text = buildClientDigest(GOLDEN_ITEMS, opts);
    expect(text.endsWith(`📊 Дашборд доступен по кнопке ниже\n${DIGEST_DASHBOARD_URL}`)).toBe(true);
  });
});

describe("digest section limit (DIGEST_MAX_PER_SECTION)", () => {
  it("keeps at most 10 cards per section and puts the rest in the dashboard line", () => {
    expect(MAX_ITEMS_PER_SECTION).toBe(10);
    const text = buildClientDigest(GOLDEN_ITEMS, opts);
    const aiNews = text.slice(text.indexOf("🛠 *ИИ-новости*"), text.indexOf("🔬 *ИИ для науки*"));
    expect(aiNews.match(/^▫️ /gm)).toHaveLength(10);
    expect(aiNews).toContain("Ещё 2 материала — в дашборде.");
  });

  it("defaults to 10, accepts 3..20 and rejects a value outside the range", () => {
    expect(digestMaxPerSection(undefined)).toBe(10);
    expect(digestMaxPerSection("")).toBe(10);
    expect(digestMaxPerSection("  ")).toBe(10);
    expect(digestMaxPerSection("3")).toBe(3);
    expect(digestMaxPerSection("15")).toBe(15);
    expect(digestMaxPerSection("20")).toBe(20);
    for (const raw of ["2", "0", "21", "abc", "7.5"]) {
      expect(() => digestMaxPerSection(raw)).toThrow(/DIGEST_MAX_PER_SECTION/);
    }
    expect(DIGEST_MAX_PER_SECTION_MIN).toBe(3);
    expect(DIGEST_MAX_PER_SECTION_MAX).toBe(20);
  });

  it("lets one run override the section size without touching the split", () => {
    const text = buildClientDigest(GOLDEN_ITEMS, { ...opts, maxItemsPerSection: 3 });
    const aiNews = text.slice(text.indexOf("🛠 *ИИ-новости*"), text.indexOf("🔬 *ИИ для науки*"));
    expect(aiNews.match(/^▫️ /gm)).toHaveLength(3);
    expect(aiNews).toContain("Ещё 9 материалов — в дашборде.");
    // The 4000-char split is unchanged: the long message still splits at lines.
    const parts = splitTelegramText(text, 800);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("\n")).toBe(text);
  });
});

describe("client digest is clean of service data (R17i)", () => {
  const serviceMarkers = [
    "⚙️",
    "Конвейер",
    "собрано",
    "отсеяно",
    "оценено",
    "Zen",
    "фиды",
    "ошибк",
    "Ошибк",
    "⚠️",
    "HTTP",
    "failed",
  ];

  it("contains no health line, error codes or funnel counters with non-zero stats nearby", () => {
    const text = buildClientDigest(GOLDEN_ITEMS, opts);
    for (const marker of serviceMarkers) expect(text).not.toContain(marker);
    // Same fixture, owner side: the counters are real and non-zero.
    expect(GOLDEN_CYCLE_STATS.collected).toBeGreaterThan(0);
    expect(GOLDEN_CYCLE_STATS.rejected).toBeGreaterThan(0);
    for (const marker of ["собрано", "отсеяно", "Ошибки"]) {
      expect(buildOwnerReport(GOLDEN_CYCLE_STATS, { ...opts, healthLine: GOLDEN_HEALTH_LINE })).toContain(marker);
    }
  });

  it("sends a neutral no-news message without mentioning the pipeline", () => {
    const text = buildEmptyClientDigest(opts);
    expect(text).toContain("новых публикаций нет");
    expect(text).not.toContain("конвейер");
    expect(text).not.toContain("Конвейер");
    expect(text).toContain(DIGEST_DASHBOARD_URL);
  });
});

describe("owner preview envelope", () => {
  it("wraps exactly the client text between the hour-ahead warning and the check line", () => {
    const clientText = buildClientDigest(GOLDEN_ITEMS, opts);
    const preview = buildPreviewDigest(clientText);
    expect(PREVIEW_HEADER).toBe("⏰ Предпросмотр: через час этот выпуск уйдёт клиенту");
    expect(PREVIEW_FOOTER).toBe("Проверь и, если что-то не так, отключи отправку до 09:00");
    expect(preview.startsWith(PREVIEW_HEADER)).toBe(true);
    expect(preview.endsWith(PREVIEW_FOOTER)).toBe(true);
    expect(preview).toContain(clientText);
  });

  it("keeps every card of the release untouched inside the envelope", () => {
    const clientText = buildClientDigest(GOLDEN_ITEMS, opts);
    const preview = buildPreviewDigest(clientText);
    const cards = clientText.split("\n").filter((line) => line.startsWith("▫️ "));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(preview).toContain(card);
    // The preview is the same release, not a re-render: no card is lost.
    expect(preview.split("\n").filter((line) => line.startsWith("▫️ "))).toEqual(cards);
  });

  it("wraps an empty-day release the same way", () => {
    const preview = buildPreviewDigest(buildEmptyClientDigest(opts));
    expect(preview.startsWith(PREVIEW_HEADER)).toBe(true);
    expect(preview).toContain("новых публикаций нет");
    expect(preview.endsWith(PREVIEW_FOOTER)).toBe(true);
  });
});

describe("fitSummary (R09)", () => {
  it("truncates a 200+ character summary to at most 180 characters on a word boundary", () => {
    const fitted = fitSummary(LONG_SUMMARY);
    expect(fitted.length).toBeLessThanOrEqual(180);
    expect(fitted).toBe(
      "Учёные представили метод, который позволяет предсказывать свойства новых материалов " +
        "с помощью нейросети и сокращает время поиска с недель до нескольких минут без потери точности",
    );
    expect(fitted.endsWith("точности")).toBe(true);
  });

  it("cuts at the last whole word that fits the limit", () => {
    expect(fitSummary("один два три четыре", 9)).toBe("один два");
  });

  it("collapses whitespace and leaves short summaries untouched", () => {
    expect(fitSummary("  два   пробела  ")).toBe("два пробела");
    expect(fitSummary("Короткая выжимка.")).toBe("Короткая выжимка.");
  });

  it("stays at 180 characters for the longer 400–500 character card summary", () => {
    // The dashboard card now carries a longer summary; the Telegram copy is
    // still the agreed 180 characters and still ends on a whole word.
    expect(SUMMARY_MAX_CHARS).toBe(180);
    const cardSummary = "нейросеть предсказывает свойства новых материалов ".repeat(12).trim();
    expect(cardSummary.length).toBeGreaterThan(400);
    const fitted = fitSummary(cardSummary);
    expect(fitted.length).toBeLessThanOrEqual(180);
    expect(fitted.length).toBeGreaterThan(160);
    expect(cardSummary.startsWith(fitted)).toBe(true);
    expect(cardSummary[fitted.length]).toBe(" ");
  });
});

describe("formatItem", () => {
  it("puts the source link on the title and the summary after a dash", () => {
    expect(formatItem(GOLDEN_ITEMS[0])).toBe(
      "▫️ [DeepSeek выпустила модель V4.1 Flash](https://deepseek.example/news/v41) — " +
        "Модель отвечает вдвое быстрее и доступна в открытых весах.",
    );
  });

  it("omits the dash when there is no summary and still links the title", () => {
    const item: DigestItem = { ...GOLDEN_ITEMS[0], summary: null };
    expect(formatItem(item)).toBe("▫️ [DeepSeek выпустила модель V4.1 Flash](https://deepseek.example/news/v41)");
  });

  it("escapes Markdown control characters in dynamic text", () => {
    const item: DigestItem = {
      ...GOLDEN_ITEMS[0],
      title: "Звёздочки *в* _заголовке_",
      summary: "Ссылка [в никуда] и `код`",
    };
    const card = formatItem(item);
    expect(card).toContain("Звёздочки \\*в\\* \\_заголовке\\_");
    expect(card).toContain("Ссылка \\[в никуда\\] и \\`код\\`");
  });
});

describe("owner report (R17, R18)", () => {
  it("carries collected / rejected / published, top-3 reasons, errors and health", () => {
    expect(buildOwnerReport(GOLDEN_CYCLE_STATS, { ...opts, healthLine: GOLDEN_HEALTH_LINE })).toBe(
      GOLDEN_OWNER_REPORT,
    );
  });

  it("shows both daily counters: scored of SCORE_DAILY_CAP and published of DAILY_BUDGET", () => {
    const report = buildOwnerReport(GOLDEN_CYCLE_STATS, opts);
    expect(report).toContain("Оценено: 18 из 200 · опубликовано: 8 из 50");
    expect(report).toMatch(/оценено: \d+ из \d+/i);
    expect(report).toMatch(/опубликовано: \d+ из \d+/i);
    // A legacy caller without the caps keeps the old report shape.
    const legacy = buildOwnerReport(
      { collected: 10, rejected: 2, published: 1 },
      opts,
    );
    expect(legacy).not.toContain("Оценено:");
  });

  it("keeps only the top three rejection reasons", () => {
    const report = buildOwnerReport(GOLDEN_CYCLE_STATS, opts);
    expect(report).toContain("no-ai-signal — 71");
    expect(report).toContain("low-confidence — 19");
    expect(report).not.toContain("duplicate");
  });

  it("alerts about an empty release instead of staying silent", () => {
    const report = buildOwnerReport(
      { collected: 100, rejected: 100, published: 0, rejectedByReason: {} },
      opts,
    );
    expect(report).toContain("⚠️ Публикаций нет");
    expect(report).toContain("Причины отказа: нет");
    expect(report).toContain("Ошибок нет.");
  });
});

describe("owner report: token spend by stage and the day's remainder (R13)", () => {
  it("prints judge, review and summary spend plus what is left of the daily budget", () => {
    const usage = {
      calls: 4,
      inputTokens: 4_000,
      outputTokens: 400,
      judge: { calls: 1, inputTokens: 450, outputTokens: 50 },
      review: { calls: 1, inputTokens: 560, outputTokens: 60 },
      summary: { calls: 2, inputTokens: 2_990, outputTokens: 290 },
    };
    const report = buildOwnerReport(
      {
        collected: 10,
        rejected: 2,
        published: 1,
        usage,
        dailyTokenBudget: 800_000,
      },
      opts,
    );

    expect(report).toContain("По стадиям");
    expect(report).toContain("судья 1 вызов");
    expect(report).toContain("проверка 1 вызов");
    expect(report).toContain("выжимка 2 вызова");
    expect(report).toContain("Бюджет токенов: 4400 / 800000");
    expect(report).toContain("остаток 795600");
  });

  it("keeps the old one-line token total when no stage split was recorded", () => {
    const report = buildOwnerReport(
      {
        collected: 10,
        rejected: 2,
        published: 1,
        usage: { calls: 3, inputTokens: 300, outputTokens: 30 },
      },
      opts,
    );
    expect(report).toContain("Токены за сутки: 3 вызова · вход 300 · выход 30");
    expect(report).not.toContain("По стадиям");
    expect(report).not.toContain("остаток");
  });
});

describe("Telegram splitting", () => {
  it("starts the continuation with a card and never repeats the digest header", () => {
    const parts = splitTelegramText(GOLDEN_CLIENT_DIGEST, 800);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(800);
    expect(parts[0]).toContain("🌅 *Утренний дайджест научного агента*");
    for (const part of parts.slice(1)) expect(part).not.toContain("🌅");
    expect(parts[1].startsWith("▫️ ")).toBe(true);
    expect(parts.join("\n")).toBe(GOLDEN_CLIENT_DIGEST);
  });
});

describe("recipients: env lists plus database subscribers", () => {
  it("adds subscribers to the client list without duplicates", () => {
    const recipients = resolveRecipients(
      { TELEGRAM_CLIENT_CHAT_IDS: "111, 222", TELEGRAM_OWNER_CHAT_IDS: "999" },
      ["222", "333", "333"],
    );
    // Env order stays stable; the subscriber that repeats an env id is skipped.
    expect(recipients.client).toEqual(["111", "222", "333"]);
    expect(recipients.owner).toEqual(["999"]);
  });

  it("delivers to a subscriber when no client id is configured at all", () => {
    expect(resolveRecipients({}, ["42"]).client).toEqual(["42"]);
  });

  it("never turns a subscriber into an owner", () => {
    const recipients = resolveRecipients({ TELEGRAM_OWNER_CHAT_IDS: "999" }, ["42"]);
    expect(recipients.owner).toEqual(["999"]);
    expect(recipients.client).toEqual(["42"]);
  });

  it("keeps the legacy shared list as the client fallback", () => {
    expect(resolveRecipients({ TELEGRAM_CHAT_IDS: "'5'" }, ["5", "6"]).client).toEqual(["5", "6"]);
  });
});
