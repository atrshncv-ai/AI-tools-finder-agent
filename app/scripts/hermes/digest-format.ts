/**
 * digest-format.ts — the ONE place that renders the Telegram messages (R21).
 *
 * Two audiences, two builders (R11, R17i):
 *   - `buildClientDigest` — exactly the form the customer approved on 26.08:
 *     header, date, counter, three sections in fixed order, cards with the
 *     source link on the title, a "Ещё N материалов — в дашборде" line and the
 *     dashboard address in the footer. Nothing else: no health line, no error
 *     codes, no funnel counters.
 *   - `buildOwnerReport` — the owner-only service message with collected /
 *     rejected / published, top-3 rejection reasons and errors.
 *
 * Pure module: no DB, no network, no env. The caller decides what to send and
 * to whom. Markdown escaping, section order and the 7-card limit stay here.
 */

import { SECTIONS, type SectionId, type SectionSpec } from "./topics";

/** Telegram text limit per message. */
export const TELEGRAM_MAX_LEN = 4000;
/** The digest covers the last 24 hours; the text and the query share it. */
export const DIGEST_WINDOW_HOURS = 24;
/** Reference form: at most seven cards per section, the rest in the dashboard. */
export const MAX_ITEMS_PER_SECTION = 7;
/** R09: a summary is at most 180 characters and never cut mid-word. */
export const SUMMARY_MAX_CHARS = 180;

export interface DigestItem {
  id: number;
  title: string;
  originalUrl: string;
  source: string | null;
  isScience: boolean | null;
  section: string;
  sphereTags: string[];
  summary?: string | null;
}

export interface DigestOptions {
  /** Publication day; rendered in Moscow time, as the approved sample. */
  date: Date;
  dashboardUrl: string;
}

export interface OwnerReportOptions extends DigestOptions {
  /** Pipeline health line (built by pipeline-health.ts), owner-only. */
  healthLine?: string;
}

/**
 * Funnel counters for the owner report. Numbers come from the caller (the
 * pipeline / pipeline_state.metrics); this module only renders them.
 */
export interface CycleStats {
  collected: number;
  rejected: number;
  published: number;
  rejectedByPrefilter?: number;
  rejectedByJudge?: number;
  /** Rejection reason (machine code or judge reason) → count. */
  rejectedByReason?: Record<string, number>;
  /** Token spend of the day's cycle (`pipeline_state.metrics.usage`, R13). */
  usage?: { calls: number; inputTokens: number; outputTokens: number } | null;
  /** Errors that happened during the cycle, one line each. */
  errors?: readonly string[];
}

/** Telegram legacy-Markdown escaping for dynamic text. */
function esc(text: string): string {
  return text.replace(/([_*[\]`])/g, "\\$1");
}

/**
 * One-line summary: collapse whitespace, then cut on a word boundary at or
 * before `max` characters. A trailing comma/colon/dash left by the cut is
 * dropped so the line does not end on a dangling separator.
 */
export function fitSummary(text: string, max = SUMMARY_MAX_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (max <= 0) return "";
  if (normalized.length <= max) return normalized;
  const hardCut = normalized.slice(0, max);
  const boundary = hardCut.lastIndexOf(" ");
  const cut = boundary > 0 ? hardCut.slice(0, boundary) : hardCut;
  return cut.replace(/[\s,;:—–-]+$/u, "");
}

/** `▫️ [Заголовок](url) — выжимка` with the source link on the title. */
export function formatItem(item: DigestItem): string {
  const title = esc(item.title.replace(/\s+/g, " ").trim());
  const summary = item.summary ? esc(fitSummary(item.summary)) : "";
  return `▫️ [${title}](${item.originalUrl})${summary ? ` — ${summary}` : ""}`;
}

/** Russian plural for the "Ещё N материалов" line (R21: fix the wording). */
function materialWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "материал";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "материала";
  return "материалов";
}

function digestDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });
}

/**
 * Which agreed section an item belongs to. Known section ids win; a legacy row
 * with an empty/unknown section falls back to `isScience`, like the old digest.
 */
function sectionOf(item: DigestItem): SectionId {
  const known = SECTIONS.find((section) => section.id === item.section);
  if (known) return known.id;
  return item.isScience ? "science" : "ai-news";
}

function formatSection(section: SectionSpec, items: DigestItem[]): string[] {
  const lines = [`${section.emoji} *${esc(section.label)}* — ${items.length}`];
  for (const item of items.slice(0, MAX_ITEMS_PER_SECTION)) lines.push(formatItem(item));
  const rest = items.length - MAX_ITEMS_PER_SECTION;
  if (rest > 0) lines.push(`Ещё ${rest} ${materialWord(rest)} — в дашборде.`);
  lines.push("");
  return lines;
}

/**
 * The client message: exactly the approved form and nothing else. Callers must
 * not append service data to it — owner-only details go to `buildOwnerReport`.
 */
export function buildClientDigest(items: DigestItem[], opts: DigestOptions): string {
  const bySection = new Map<SectionId, DigestItem[]>();
  for (const item of items) {
    const id = sectionOf(item);
    const bucket = bySection.get(id);
    if (bucket) bucket.push(item);
    else bySection.set(id, [item]);
  }

  const lines = [
    "🌅 *Утренний дайджест научного агента*",
    `_${digestDate(opts.date)}_`,
    "",
    `За последние ${DIGEST_WINDOW_HOURS} часа опубликовано: *${items.length}*`,
    "",
  ];
  for (const section of SECTIONS) {
    const sectionItems = bySection.get(section.id);
    if (sectionItems && sectionItems.length > 0) lines.push(...formatSection(section, sectionItems));
  }
  lines.push("📊 Дашборд доступен по кнопке ниже", opts.dashboardUrl);
  return lines.join("\n");
}

/** Empty day: one neutral client message, no pipeline talk (R17i). */
export function buildEmptyClientDigest(opts: DigestOptions): string {
  return [
    "🌅 *Утренний дайджест научного агента*",
    `_${digestDate(opts.date)}_`,
    "",
    `За последние ${DIGEST_WINDOW_HOURS} часа новых публикаций нет.`,
    "",
    "📊 Дашборд доступен по кнопке ниже",
    opts.dashboardUrl,
  ].join("\n");
}

/** Russian plural for the "N вызовов" counter in the owner report. */
function callWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "вызов";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "вызова";
  return "вызовов";
}

function formatReasons(reasons: Record<string, number> | undefined): string {
  const entries = Object.entries(reasons ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  if (entries.length === 0) return "нет";
  return entries
    .slice(0, 3)
    .map(([reason, count]) => `${esc(reason)} — ${count}`)
    .join(" · ");
}

/**
 * Owner-only service report (R17, R18): funnel counters, top-3 rejection
 * reasons, errors and the pipeline health line. Never sent to a client.
 */
export function buildOwnerReport(stats: CycleStats, opts: OwnerReportOptions): string {
  const lines = [
    `🧾 *Служебный отчёт* · ${digestDate(opts.date)}`,
    "",
    `Собрано: ${stats.collected} · отсеяно: ${stats.rejected} · опубликовано: ${stats.published}`,
  ];
  if (stats.rejectedByPrefilter != null || stats.rejectedByJudge != null) {
    lines.push(
      `Отсеяно префильтром: ${stats.rejectedByPrefilter ?? "—"} · судьёй: ${stats.rejectedByJudge ?? "—"}`,
    );
  }
  if (stats.usage) {
    // R13: "хз на сколько хватит" is answered by a number, not by a feeling.
    lines.push(
      `Токены за сутки: ${stats.usage.calls} ${callWord(stats.usage.calls)} · ` +
        `вход ${stats.usage.inputTokens} · выход ${stats.usage.outputTokens}`,
    );
  }
  lines.push(`Причины отказа: ${formatReasons(stats.rejectedByReason)}`);
  if (stats.collected === 0) {
    lines.push("", "⚠️ Сбор пуст: за сутки не собрано ни одного материала.");
  } else if (stats.published === 0) {
    lines.push("", "⚠️ Публикаций нет: выпуск пустой.");
  }
  lines.push("");
  const errors = stats.errors ?? [];
  if (errors.length > 0) {
    lines.push("⚠️ Ошибки:", ...errors.map((error) => `• ${esc(error)}`));
  } else {
    lines.push("Ошибок нет.");
  }
  if (opts.healthLine) lines.push("", opts.healthLine);
  lines.push("", `📊 Дашборд: ${opts.dashboardUrl}`);
  return lines.join("\n");
}

/**
 * Split a long message at line boundaries, keeping Telegram's 4000-char limit.
 * Continuation parts start with the next card: the header is never repeated.
 */
export function splitTelegramText(text: string, maxLen = TELEGRAM_MAX_LEN): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
