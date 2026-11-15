import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPaymentReminderDay,
  paymentReminderText,
  planDigestDelivery,
  previewRequested,
  resolveRecipients,
  sendTelegram,
} from "./daily-digest";
import {
  buildClientDigest,
  buildEmptyClientDigest,
  PREVIEW_FOOTER,
  PREVIEW_HEADER,
  splitTelegramText,
  type DigestItem,
} from "./digest-format";
import { formatHealthLine, type PipelineStats } from "./pipeline-health";

const opts = {
  date: new Date("2026-08-26T09:00:00+03:00"),
  dashboardUrl: "https://nauchny-agent.ru/dashboard",
};

const healthyStats: PipelineStats = {
  collected: 210, evaluated: 180, published: 46, processingErrors: 4,
  feedsTotal: 13, feedsFailing: 0, failingFeedNames: [],
  zenPoolSize: 4, zenCoolingKeys: 1, zenStateUpdatedAt: null,
  lastPublishedAt: new Date(Date.now() - 3600_000),
};

const item = (overrides: Partial<DigestItem> = {}): DigestItem => ({
  id: 1,
  title: "Новость",
  originalUrl: "https://example.com/n",
  source: "rss",
  isScience: false,
  section: "ai-news",
  sphereTags: [],
  ...overrides,
});

describe("recipients (R11, R17)", () => {
  it("takes client and owner addresses from separate variables", () => {
    const recipients = resolveRecipients({
      TELEGRAM_CLIENT_CHAT_IDS: "111, 222",
      TELEGRAM_OWNER_CHAT_IDS: "999",
    });
    expect(recipients).toEqual({ client: ["111", "222"], owner: ["999"] });
  });

  it("keeps sending to the client when no owner address is configured", () => {
    const recipients = resolveRecipients({ TELEGRAM_CLIENT_CHAT_IDS: "111" });
    expect(recipients.client).toEqual(["111"]);
    expect(recipients.owner).toEqual([]);
  });

  it("falls back to the legacy shared list as client recipients", () => {
    expect(resolveRecipients({ TELEGRAM_CHAT_IDS: "5,6" }).client).toEqual(["5", "6"]);
    expect(resolveRecipients({ TELEGRAM_CHAT_ID: "'7'" }).client).toEqual(["7"]);
    expect(resolveRecipients({ TELEGRAM_CLIENT_CHAT_IDS: "", TELEGRAM_CHAT_IDS: "8" }).client).toEqual(["8"]);
  });
});

describe("empty-day heartbeat", () => {
  it("produces an explicit no-news client message so silence always means failure", () => {
    const text = buildEmptyClientDigest(opts);
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

describe("client digest sections", () => {
  it("never puts the health line or funnel counters into the client message", () => {
    const text = buildClientDigest([item()], opts);
    expect(text).toContain("опубликовано: *1*");
    expect(text).not.toContain("⚙️");
    expect(text).not.toContain("собрано");
    expect(text).not.toContain("отсеяно");
    // The health line itself still exists — it is owner-only.
    expect(formatHealthLine(healthyStats)).toContain("⚙️ Конвейер");
  });

  it("uses exactly the three fixed product sections", () => {
    const text = buildClientDigest(
      [
        item({ id: 1, title: "Видео", originalUrl: "https://example.com/v", source: "youtube-demo" }),
        item({
          id: 2,
          title: "Материал",
          originalUrl: "https://example.com/m",
          source: "nature",
          isScience: true,
          section: "invention-tools",
          sphereTags: ["materials"],
        }),
      ],
      opts,
    );
    expect(text).toContain("ИИ-новости");
    expect(text).toContain("Инструменты для изобретений");
    expect(text).not.toContain("Видео с YouTube");
  });

  it("uses tappable Telegram links and short descriptions in every section", () => {
    const text = buildClientDigest(
      [
        item({ id: 1, title: "ИИ-новость", originalUrl: "https://example.com/news", summary: "Краткое описание новости." }),
        item({
          id: 2,
          title: "Научный инструмент",
          originalUrl: "https://example.com/science",
          source: "nature",
          isScience: true,
          section: "science",
          sphereTags: ["biology"],
          summary: "Краткое описание научного инструмента.",
        }),
        item({
          id: 3,
          title: "Инструмент для изобретений",
          originalUrl: "https://example.com/invention",
          source: "catalog",
          section: "invention-tools",
          summary: "Краткое описание инструмента для изобретений.",
        }),
      ],
      opts,
    );

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
      item({ id: 1, title: "Свежая ИИ-новость", originalUrl: "https://example.com/a", source: "hn" }),
    ];
    const text = buildClientDigest(fresh, opts);
    expect(text).toContain("опубликовано: *1*");
    expect(text).not.toContain("Из архива");
    expect(text).not.toContain("Архивная статья про CRISPR");
    expect(text).not.toContain("ИИ для науки — 1");
  });
});

describe("sendTelegram retry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns true when a transient network failure is followed by success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendTelegram("hello", "123")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("returns false when every attempt fails at the network level", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendTelegram("hello", "123")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 20_000);
});

describe("digest markdown safety (Telegram parse_mode=Markdown)", () => {
  const tricky = [
    item({
      id: 1,
      title: "Звёздочки *в* _заголовке_ и [скобки]",
      originalUrl: "https://example.com/a",
      source: "hn",
      sphereTags: ["ai"],
      summary: "Саммари с `бэктиками` и *звёздочкой*",
    }),
    item({
      id: 2,
      title: "Обычный заголовок",
      originalUrl: "https://example.com/b",
      source: null,
      isScience: true,
      section: "science",
      summary: null,
    }),
  ];

  it("header bold is closed (regression: Telegram 400 can't find end of entity)", () => {
    const text = buildClientDigest(tricky, opts);
    expect(text).toContain("*Утренний дайджест научного агента*");
  });

  it("all legacy-Markdown entities are balanced after escaping", () => {
    const text = buildClientDigest(tricky, opts);
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

describe("owner preview before the client release (--preview, DIGEST_PREVIEW=1)", () => {
  const recipients = { client: ["111", "222"], owner: ["999"] };
  const releaseItems: DigestItem[] = [
    item({
      id: 1,
      title: "ИИ-новость",
      originalUrl: "https://example.com/news",
      summary: "Краткое описание новости.",
    }),
    item({
      id: 2,
      title: "Научный инструмент",
      originalUrl: "https://example.com/science",
      isScience: true,
      section: "science",
      summary: "Краткое описание научного инструмента.",
    }),
    item({
      id: 3,
      title: "Инструмент для изобретений",
      originalUrl: "https://example.com/invention",
      section: "invention-tools",
      summary: "Краткое описание инструмента для изобретений.",
    }),
  ];
  const releaseText = buildClientDigest(releaseItems, opts);
  const releaseParts = splitTelegramText(releaseText);
  const report = "🧾 *Служебный отчёт* · собрано: 10 · отсеяно: 4 · опубликовано: 3";
  const cardsOf = (text: string) => text.split("\n").filter((line) => line.startsWith("▫️ "));

  it("turns on with --preview or DIGEST_PREVIEW=1 and stays off otherwise", () => {
    expect(previewRequested(["--preview"], {})).toBe(true);
    expect(previewRequested(["--dry-run", "--preview"], {})).toBe(true);
    expect(previewRequested([], { DIGEST_PREVIEW: "1" })).toBe(true);
    expect(previewRequested([], { DIGEST_PREVIEW: " 1 " })).toBe(true);
    expect(previewRequested([], {})).toBe(false);
    expect(previewRequested(["--preview=0"], {})).toBe(false);
    expect(previewRequested([], { DIGEST_PREVIEW: "0" })).toBe(false);
  });

  it("sends the release to no client address and skips the service report", () => {
    const plan = planDigestDelivery({ recipients, clientParts: releaseParts, report, preview: true });
    expect(plan.preview).toBe(true);
    expect(plan.client.chatIds).toEqual([]);
    expect(plan.client.parts).toEqual([]);
    expect(plan.ownerReport).toBeNull();
  });

  it("gives the owner the same cards as the release plus the preview markers", () => {
    const normal = planDigestDelivery({ recipients, clientParts: releaseParts, report, preview: false });
    const preview = planDigestDelivery({ recipients, clientParts: releaseParts, report, preview: true });

    expect(preview.ownerCopy.chatIds).toEqual(["999"]);
    const previewText = preview.ownerCopy.parts.join("\n");
    expect(previewText).toBe(`${PREVIEW_HEADER}\n\n${releaseText}\n\n${PREVIEW_FOOTER}`);

    const releaseCards = cardsOf(normal.client.parts.join("\n"));
    expect(releaseCards).toHaveLength(3);
    for (const card of releaseCards) expect(previewText).toContain(card);
    expect(cardsOf(previewText)).toEqual(releaseCards);
  });

  it("keeps the normal run unchanged when the flag is absent", () => {
    const plan = planDigestDelivery({ recipients, clientParts: releaseParts, report, preview: false });
    expect(plan.preview).toBe(false);
    expect(plan.client.chatIds).toEqual(["111", "222"]);
    expect(plan.client.parts).toEqual(releaseParts);
    expect(plan.ownerCopy.chatIds).toEqual(["999"]);
    expect(plan.ownerCopy.parts).toEqual(releaseParts);
    expect(plan.ownerReport?.chatIds).toEqual(["999"]);
    expect(plan.ownerReport?.parts.join("\n")).toBe(report);
    // Nothing of the preview envelope leaks into the customer's text.
    expect(plan.client.parts.join("\n")).not.toContain(PREVIEW_HEADER);
    expect(plan.client.parts.join("\n")).not.toContain(PREVIEW_FOOTER);
  });

  it("never duplicates the clean digest when the owner is also a client", () => {
    const plan = planDigestDelivery({
      recipients: { client: ["999"], owner: ["999", "777"] },
      clientParts: releaseParts,
      report,
      preview: false,
    });
    expect(plan.ownerCopy.chatIds).toEqual(["777"]);
    expect(plan.ownerReport?.chatIds).toEqual(["999", "777"]);
  });

  it("keeps both markers when a long release has to be split into parts", () => {
    const longItems = Array.from({ length: 40 }, (_, index) =>
      item({
        id: index + 1,
        title: `Материал ${index + 1}`,
        originalUrl: `https://example.com/materials/${index + 1}`,
        summary: "Подробная выжимка материала с описанием метода, результатов и ограничений исследования. ".repeat(3),
      }),
    );
    const longText = buildClientDigest(longItems, { ...opts, maxItemsPerSection: 20 });
    expect(longText.length).toBeGreaterThan(4000);
    const parts = splitTelegramText(longText);
    const plan = planDigestDelivery({ recipients, clientParts: parts, report, preview: true });
    const previewText = plan.ownerCopy.parts.join("\n");

    expect(plan.ownerCopy.parts.length).toBeGreaterThan(1);
    expect(previewText.startsWith(PREVIEW_HEADER)).toBe(true);
    expect(previewText.endsWith(PREVIEW_FOOTER)).toBe(true);
    expect(previewText).toContain("🌅 *Утренний дайджест научного агента*");
    for (const card of cardsOf(parts.join("\n"))) expect(previewText).toContain(card);
    for (const part of plan.ownerCopy.parts) expect(part.length).toBeLessThanOrEqual(4000);
  });
});
