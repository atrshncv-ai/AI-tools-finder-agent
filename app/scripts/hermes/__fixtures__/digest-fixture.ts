/**
 * Fixed digest fixtures for the golden test (R21, R17i).
 *
 * The expected strings below are written by hand from `.autopilot/…/reference.md`
 * (the form the customer approved on 26.08) — never produced by the code under
 * test. Changing them means re-agreeing the form with the customer, not
 * "fixing" a test.
 */

import type { CycleStats, DigestItem } from "../digest-format";

/** 26.08 10:00 MSK — the date of the approved sample. */
export const DIGEST_DATE = new Date("2026-08-26T09:00:00+03:00");

export const DIGEST_DASHBOARD_URL = "https://nauchny-agent.ru/dashboard";

/**
 * Twelve AI-news items: seven cards plus "Ещё 5 материалов — в дашборде",
 * two "AI for science" and one "invention tools" — all three sections present,
 * fixed order, non-zero counters.
 */
export const GOLDEN_ITEMS: DigestItem[] = [
  {
    id: 1,
    title: "DeepSeek выпустила модель V4.1 Flash",
    originalUrl: "https://deepseek.example/news/v41",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Модель отвечает вдвое быстрее и доступна в открытых весах.",
  },
  {
    id: 2,
    title: "OpenAI показала агента для рабочего стола",
    originalUrl: "https://openai.example/blog/desktop-agent",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Агент работает с файлами и терминалом локально, без облака.",
  },
  {
    id: 3,
    title: "GigaChat обновил API и добавил function calling",
    originalUrl: "https://sber.example/gigachat-api",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Новые вызовы совместимы с форматом OpenAI, цены не изменились.",
  },
  {
    id: 4,
    title: "Anthropic: модель научилась проверять свой код",
    originalUrl: "https://anthropic.example/research/verifier",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Внутренний проверщик снижает число неверных правок на треть.",
  },
  {
    id: 5,
    title: "Mistral открыла веса модели для кода",
    originalUrl: "https://mistral.example/news/code",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Модель обучена на 80 языках программирования.",
  },
  {
    id: 6,
    title: "Китай вводит обязательную маркировку ИИ-контента",
    originalUrl: "https://regulator.example/ai-label",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Требование вступает в силу с 1 сентября.",
  },
  {
    id: 7,
    title: "GitHub: Copilot перешёл на новый движок",
    originalUrl: "https://github.example/blog/copilot",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Автодополнение стало точнее на 20% по внутренним тестам.",
  },
  {
    id: 8,
    title: "Хабр разобрал, как устроен RAG на ста строках",
    originalUrl: "https://habr.example/rag-100",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Автор показывает минимальный конвейер без фреймворков.",
  },
  {
    id: 9,
    title: "Вышла книга о безопасности ИИ-агентов",
    originalUrl: "https://book.example/ai-agent-security",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Авторы разбирают атаки на инструменты и защиту от них.",
  },
  {
    id: 10,
    title: "Nvidia показала чип для обучения моделей",
    originalUrl: "https://nvidia.example/chip",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Ускоритель обещает вдвое больше памяти на ту же плату.",
  },
  {
    id: 11,
    title: "ЕС согласовал правила для базовых моделей",
    originalUrl: "https://eu.example/ai-act",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Документ вступит в силу после ратификации.",
  },
  {
    id: 12,
    title: "Yandex открыл датасет для оценки ИИ",
    originalUrl: "https://yandex.example/dataset",
    source: "rss",
    isScience: false,
    section: "ai-news",
    sphereTags: [],
    summary: "Набор содержит 10 тысяч задач на русском языке.",
  },
  {
    id: 13,
    title: "ИИ предсказывает структуру белков без выравнивания",
    originalUrl: "https://nature.example/protein",
    source: "nature",
    isScience: true,
    section: "science",
    sphereTags: ["biology"],
    summary: "Подход ускоряет поиск лекарств на порядок, утверждают авторы.",
  },
  {
    id: 14,
    title: "Физики ускорили расчёт квантовых схем с помощью ИИ",
    originalUrl: "https://arxiv.example/quantum-ai",
    source: "arxiv",
    isScience: true,
    section: "science",
    sphereTags: ["physics"],
    summary: "Нейросеть заменяет часть точных симуляций.",
  },
  {
    id: 15,
    title: "Открыт набор данных для ИИ-химии",
    originalUrl: "https://toolkit.example/dataset",
    source: "catalog",
    isScience: false,
    section: "invention-tools",
    sphereTags: ["chemistry"],
    summary: "Датасет содержит два миллиона реакций с условиями синтеза.",
  },
];

/** Exactly the approved form: header, date, counter, 3 sections, cards, "Ещё", footer. */
export const GOLDEN_CLIENT_DIGEST = [
  "🌅 *Утренний дайджест научного агента*",
  "_26 августа 2026 г._",
  "",
  "За последние 24 часа опубликовано: *15*",
  "",
  "🛠 *ИИ-новости* — 12",
  "▫️ [DeepSeek выпустила модель V4.1 Flash](https://deepseek.example/news/v41) — Модель отвечает вдвое быстрее и доступна в открытых весах.",
  "▫️ [OpenAI показала агента для рабочего стола](https://openai.example/blog/desktop-agent) — Агент работает с файлами и терминалом локально, без облака.",
  "▫️ [GigaChat обновил API и добавил function calling](https://sber.example/gigachat-api) — Новые вызовы совместимы с форматом OpenAI, цены не изменились.",
  "▫️ [Anthropic: модель научилась проверять свой код](https://anthropic.example/research/verifier) — Внутренний проверщик снижает число неверных правок на треть.",
  "▫️ [Mistral открыла веса модели для кода](https://mistral.example/news/code) — Модель обучена на 80 языках программирования.",
  "▫️ [Китай вводит обязательную маркировку ИИ-контента](https://regulator.example/ai-label) — Требование вступает в силу с 1 сентября.",
  "▫️ [GitHub: Copilot перешёл на новый движок](https://github.example/blog/copilot) — Автодополнение стало точнее на 20% по внутренним тестам.",
  "Ещё 5 материалов — в дашборде.",
  "",
  "🔬 *ИИ для науки* — 2",
  "▫️ [ИИ предсказывает структуру белков без выравнивания](https://nature.example/protein) — Подход ускоряет поиск лекарств на порядок, утверждают авторы.",
  "▫️ [Физики ускорили расчёт квантовых схем с помощью ИИ](https://arxiv.example/quantum-ai) — Нейросеть заменяет часть точных симуляций.",
  "",
  "🧪 *Инструменты для изобретений* — 1",
  "▫️ [Открыт набор данных для ИИ-химии](https://toolkit.example/dataset) — Датасет содержит два миллиона реакций с условиями синтеза.",
  "",
  "📊 Дашборд доступен по кнопке ниже",
  "https://nauchny-agent.ru/dashboard",
].join("\n");

/** Non-zero funnel counters — they must never appear in the client message. */
export const GOLDEN_CYCLE_STATS: CycleStats = {
  collected: 130,
  rejected: 122,
  rejectedByPrefilter: 95,
  rejectedByJudge: 27,
  published: 8,
  rejectedByReason: {
    "no-ai-signal": 71,
    stale: 32,
    "low-confidence": 19,
    duplicate: 4,
  },
  errors: ["gigachat: 429 — запрос ушёл в opencode"],
};

export const GOLDEN_HEALTH_LINE = "⚙️ Конвейер: собрано 130 · оценено 90 · опубликовано 8";

/** Owner-only report: counters, top-3 rejection reasons, errors, health, dashboard. */
export const GOLDEN_OWNER_REPORT = [
  "🧾 *Служебный отчёт* · 26 августа 2026 г.",
  "",
  "Собрано: 130 · отсеяно: 122 · опубликовано: 8",
  "Отсеяно префильтром: 95 · судьёй: 27",
  "Причины отказа: no-ai-signal — 71 · stale — 32 · low-confidence — 19",
  "",
  "⚠️ Ошибки:",
  "• gigachat: 429 — запрос ушёл в opencode",
  "",
  "⚙️ Конвейер: собрано 130 · оценено 90 · опубликовано 8",
  "",
  "📊 Дашборд: https://nauchny-agent.ru/dashboard",
].join("\n");

/** A 200+ character summary with clean word boundaries (fitSummary input). */
export const LONG_SUMMARY =
  "Учёные представили метод, который позволяет предсказывать свойства новых материалов " +
  "с помощью нейросети и сокращает время поиска с недель до нескольких минут без потери " +
  "точности на независимом наборе данных.";
