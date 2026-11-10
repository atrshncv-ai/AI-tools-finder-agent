import { describe, expect, it } from "vitest";
import {
  buildClientDigest,
  buildEmptyClientDigest,
  buildOwnerReport,
  fitSummary,
  formatItem,
  splitTelegramText,
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
