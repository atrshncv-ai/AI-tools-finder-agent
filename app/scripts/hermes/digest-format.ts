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
 *     rejected / published, top-3 rejection reasons, real errors and notes.
 *   - `buildPreviewDigest` — the client text wrapped into the owner preview
 *     envelope (an hour-ahead warning and a "check it" line). It never alters
 *     the client message itself: the owner sees exactly what the client will.
 *
 * Pure module: no DB, no network. The caller decides what to send and to whom;
 * `resolveRecipients` only merges the lists it is given (env by default, plus
 * the subscribers the welcome flow stored in the database). Markdown escaping,
 * section order and the configurable per-section card limit stay here.
 */

import { SECTIONS, type SectionId, type SectionSpec } from "./topics";

/** Telegram text limit per message. */
export const TELEGRAM_MAX_LEN = 4000;
/** The digest covers the last 24 hours; the text and the query share it. */
export const DIGEST_WINDOW_HOURS = 24;
/**
 * Default number of cards per section. Owner decision 2026-11-15: 7 is too few
 * for a 50-card day, but a 50-card Telegram wall is unreadable, so the default
 * is 10 and `DIGEST_MAX_PER_SECTION` may widen or narrow it within 3..20.
 */
export const MAX_ITEMS_PER_SECTION = 10;
/** Allowed range for the configurable per-section card limit. */
export const DIGEST_MAX_PER_SECTION_MIN = 3;
export const DIGEST_MAX_PER_SECTION_MAX = 20;
/** R09: a summary is at most 180 characters and never cut mid-word. */
export const SUMMARY_MAX_CHARS = 180;

/** Bad digest configuration is an error, never a silent default. */
export class DigestConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigestConfigError";
  }
}

/**
 * `DIGEST_MAX_PER_SECTION` from env: cards per section in the client digest.
 * Empty = 10; the allowed range is 3..20. A typo must fail the morning run
 * loudly instead of silently shipping a one-card or a hundred-card section.
 */
export function digestMaxPerSection(raw: string | undefined = process.env.DIGEST_MAX_PER_SECTION): number {
  const value = (raw ?? "").trim();
  if (!value) return MAX_ITEMS_PER_SECTION;
  if (!/^\d+$/.test(value)) {
    throw new DigestConfigError(
      `DIGEST_MAX_PER_SECTION must be an integer between ${DIGEST_MAX_PER_SECTION_MIN} and ${DIGEST_MAX_PER_SECTION_MAX}, got "${value}"`,
    );
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < DIGEST_MAX_PER_SECTION_MIN || parsed > DIGEST_MAX_PER_SECTION_MAX) {
    throw new DigestConfigError(
      `DIGEST_MAX_PER_SECTION must be between ${DIGEST_MAX_PER_SECTION_MIN} and ${DIGEST_MAX_PER_SECTION_MAX}, got ${parsed}`,
    );
  }
  return parsed;
}

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
  /**
   * Cards per section for this message. Defaults to `MAX_ITEMS_PER_SECTION`;
   * `daily-digest.ts` passes `digestMaxPerSection()` so the env applies.
   */
  maxItemsPerSection?: number;
}

export interface OwnerReportOptions extends DigestOptions {
  /** Pipeline health line (built by pipeline-health.ts), owner-only. */
  healthLine?: string;
}

/** Who receives what: clients get the clean digest, owners the copy + report. */
export interface DigestRecipients {
  /** Client chat IDs — clean digest only. */
  client: string[];
  /** Owner chat IDs — the same digest as a copy plus the service report. */
  owner: string[];
}

/**
 * Parse a comma-separated chat-id list. Surrounding quotes are stripped per id:
 * cron sources `.env` via bash (`set -a; . ./.env`), which — unlike dotenv —
 * keeps literal quotes, and a quoted id makes Telegram reject the chat
 * ("chat not found").
 */
export function parseChatIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
}

/** First occurrence wins, so the env-defined order stays stable. */
function uniqueChatIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Client and owner recipients. A new subscriber writes `/start` to the bot and
 * is stored in `agent_state` (`.env` is edited by hand, so the list cannot live
 * there); those IDs join the env client list without duplicates. The legacy
 * shared TELEGRAM_CHAT_IDS / TELEGRAM_CHAT_ID list stays a client fallback, so
 * an existing deployment keeps delivering; the owner copy is opt-in and never
 * comes from subscribers.
 */
export function resolveRecipients(
  env: NodeJS.ProcessEnv = process.env,
  subscribers: readonly string[] = [],
): DigestRecipients {
  return {
    client: uniqueChatIds([
      ...parseChatIds(env.TELEGRAM_CLIENT_CHAT_IDS || env.TELEGRAM_CHAT_IDS || env.TELEGRAM_CHAT_ID),
      ...subscribers.map((id) => id.trim()).filter(Boolean),
    ]),
    owner: uniqueChatIds(parseChatIds(env.TELEGRAM_OWNER_CHAT_IDS || env.TELEGRAM_OWNER_CHAT_ID)),
  };
}

/** Tokens one paid stage spent. */
export interface StageUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Day's token spend: legacy totals plus the per-stage split written by the
 * `evaluate-news` / `save-summary` ledger. Stages are optional so a legacy
 * `metrics.usage` still renders the old one-line total.
 */
export interface CycleUsage extends StageUsage {
  judge?: StageUsage | null;
  review?: StageUsage | null;
  summary?: StageUsage | null;
}

/**
 * Funnel counters for the owner report. Numbers come from the caller (the
 * pipeline / pipeline_state.metrics); this module only renders them.
 */
export interface CycleStats {
  collected: number;
  rejected: number;
  published: number;
  /** Pages scored today (downloads) and the separate daily scoring cap. */
  scoredToday?: number | null;
  scoreDailyCap?: number | null;
  /** Articles published today and the hard daily publication budget. */
  publishedToday?: number | null;
  dailyBudget?: number | null;
  rejectedByPrefilter?: number;
  rejectedByJudge?: number;
  /** Rejection reason (machine code or judge reason) → count. */
  rejectedByReason?: Record<string, number>;
  /** Token spend of the day's cycle (`pipeline_state.metrics.usage`, R13). */
  usage?: CycleUsage | null;
  /** Hard daily token limit, so the report can print what is left. */
  dailyTokenBudget?: number | null;
  /** Real errors that happened during the cycle, one line each. */
  errors?: readonly string[];
  /** Single remarks (a material to retry, not an alarm), one line each. */
  notes?: readonly string[];
}

/** A provider-failure share of checked materials that always counts as an error. */
export const PROVIDER_FAILURE_SHARE_LIMIT = 0.3;
/** Absolute number of provider failures per cycle that always counts as an error. */
export const PROVIDER_FAILURE_COUNT_LIMIT = 5;

/** A finite non-negative integer, or 0 — a broken caller value must not crash the report. */
function countOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Why a provider failure is a real error and not a note: it is systemic — the
 * failed share of the checked materials is 30% or more, or there are five or
 * more failures in one cycle, or nothing was published although ready cards
 * existed. Anything smaller is retried by the next cycle and only noted.
 */
export function providerFailuresAreError(input: {
  failures: number;
  checked: number;
  ready?: number;
  published?: number;
}): boolean {
  const failures = countOrZero(input.failures);
  if (failures === 0) return false;
  const checked = countOrZero(input.checked);
  const share = checked > 0 ? failures / checked : 0;
  const blockedRelease = countOrZero(input.ready) > 0 && countOrZero(input.published) === 0;
  return (
    share >= PROVIDER_FAILURE_SHARE_LIMIT ||
    failures >= PROVIDER_FAILURE_COUNT_LIMIT ||
    blockedRelease
  );
}

/** «2 материала не обработаны, будут повторены» with the right Russian plural. */
function providerFailureNote(failures: number): string {
  const singular = failures % 10 === 1 && failures % 100 !== 11;
  return singular
    ? `${failures} материал не обработан, будет повторён`
    : `${failures} ${materialWord(failures)} не обработаны, будут повторены`;
}

/** Genitive after "из N": «из 1 материала», «из 20 материалов». */
function materialsGenitive(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? "материала" : "материалов";
}

/** The error line, naming the provider classes and the failed share. */
function providerFailureError(failures: number, checked: number, classes: readonly string[]): string {
  const named = classes.length > 0 ? `: ${classes.join(", ")}` : "";
  if (checked <= 0) return `ошибка провайдера${named} — не обработано материалов: ${failures}`;
  // A stale ledger can report fewer checked materials than failures; never
  // print the impossible "7 из 5".
  const total = Math.max(checked, failures);
  return `ошибка провайдера${named} — не обработано ${failures} из ${total} ${materialsGenitive(total)}`;
}

/** The report's two lists: real errors and remarks that need no alarm. */
export interface CycleIssues {
  errors: string[];
  notes: string[];
}

export interface CycleIssueInput {
  /** Missing or broken required env: always an error, never a note. */
  envErrors?: readonly string[];
  /** Materials the provider could not process this cycle. */
  providerFailures?: number;
  /** Materials checked this cycle — the denominator of the failure share. */
  checked?: number;
  /** Materials ready to publish and what the cycle actually published. */
  ready?: number;
  published?: number;
  /** Provider error classes, named in a real error line. */
  providerErrorClasses?: readonly string[];
}

/**
 * Split the cycle's issues into real errors and notes. Missing required env is
 * always an error; a provider failure is classified by
 * `providerFailuresAreError`. Pure, so daily-digest only supplies the ledger
 * numbers and the owner report stays decision-free.
 */
export function classifyCycleIssues(input: CycleIssueInput = {}): CycleIssues {
  const errors = [...(input.envErrors ?? [])];
  const notes: string[] = [];
  const failures = countOrZero(input.providerFailures);
  if (failures === 0) return { errors, notes };
  const checked = countOrZero(input.checked);
  if (providerFailuresAreError({ failures, checked, ready: input.ready, published: input.published })) {
    const classes = [
      ...new Set((input.providerErrorClasses ?? []).map((name) => name.trim()).filter(Boolean)),
    ].sort();
    errors.push(providerFailureError(failures, checked, classes));
  } else {
    notes.push(providerFailureNote(failures));
  }
  return { errors, notes };
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

/** A positive integer section limit; a broken caller value falls back to the default. */
function sectionLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return MAX_ITEMS_PER_SECTION;
  }
  return Math.floor(value);
}

function formatSection(section: SectionSpec, items: DigestItem[], maxItems: number): string[] {
  const shown = items.slice(0, maxItems);
  const lines = [`${section.emoji} *${esc(section.label)}* — ${items.length}`];
  for (const item of shown) lines.push(formatItem(item));
  const rest = items.length - shown.length;
  if (rest > 0) lines.push(`Ещё ${rest} ${materialWord(rest)} — в дашборде.`);
  lines.push("");
  return lines;
}

/**
 * Owner preview envelope (owner decision 2026-11-15): an hour before the client
 * release the owner receives the very same text, bracketed by two plain lines so
 * it is obvious that this copy is not the customer's and that there is still
 * time to switch the sending off. The client text itself is not re-rendered:
 * `buildClientDigest` stays the single source of the approved form.
 */
export const PREVIEW_HEADER = "⏰ Предпросмотр: через час этот выпуск уйдёт клиенту";
export const PREVIEW_FOOTER = "Проверь и, если что-то не так, отключи отправку до 09:00";

/** Wrap the exact client text into the owner preview envelope. */
export function buildPreviewDigest(clientText: string): string {
  return [PREVIEW_HEADER, "", clientText, "", PREVIEW_FOOTER].join("\n");
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
  const maxItems = sectionLimit(opts.maxItemsPerSection);

  const lines = [
    "🌅 *Утренний дайджест научного агента*",
    `_${digestDate(opts.date)}_`,
    "",
    `За последние ${DIGEST_WINDOW_HOURS} часа опубликовано: *${items.length}*`,
    "",
  ];
  for (const section of SECTIONS) {
    const sectionItems = bySection.get(section.id);
    if (sectionItems && sectionItems.length > 0) {
      lines.push(...formatSection(section, sectionItems, maxItems));
    }
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

const ZERO_STAGE: StageUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };

/** One paid stage as `судья 2 вызова · вход 900 · выход 250`. */
function stageUsageLine(label: string, usage: StageUsage | null | undefined): string {
  const value = usage ?? ZERO_STAGE;
  return `${label} ${value.calls} ${callWord(value.calls)} · вход ${value.inputTokens} · выход ${value.outputTokens}`;
}

/**
 * The per-stage split, when the cycle recorded one. A legacy usage payload
 * without stages returns `null`, so the report keeps its old single line.
 */
function formatStageBreakdown(usage: CycleUsage): string | null {
  if (!usage.judge && !usage.review && !usage.summary) return null;
  return [
    "По стадиям:",
    stageUsageLine("судья", usage.judge),
    "·",
    stageUsageLine("проверка", usage.review),
    "·",
    stageUsageLine("выжимка", usage.summary),
  ].join(" ");
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
 * The two independent daily counters: pages scored of SCORE_DAILY_CAP and
 * articles published of DAILY_BUDGET. The owner must see both, otherwise
 * "only 2 cards today" looks like a content problem when scoring actually hit
 * its cap. A legacy caller without the score cap keeps the old report shape.
 */
function formatDailyLimits(stats: CycleStats): string | null {
  const cap = stats.scoreDailyCap;
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return null;
  const scored =
    typeof stats.scoredToday === "number" && Number.isFinite(stats.scoredToday)
      ? Math.max(0, Math.floor(stats.scoredToday))
      : 0;
  const published =
    typeof stats.publishedToday === "number" && Number.isFinite(stats.publishedToday)
      ? Math.max(0, Math.floor(stats.publishedToday))
      : stats.published;
  const budget =
    typeof stats.dailyBudget === "number" &&
    Number.isFinite(stats.dailyBudget) &&
    stats.dailyBudget > 0
      ? Math.floor(stats.dailyBudget)
      : null;
  return (
    `Оценено: ${scored} из ${Math.floor(cap)} · ` +
    `опубликовано: ${published} из ${budget ?? "—"}`
  );
}

/**
 * Owner-only service report (R17, R18): funnel counters, top-3 rejection
 * reasons, real errors, notes and the pipeline health line. Never sent to a
 * client.
 */
export function buildOwnerReport(stats: CycleStats, opts: OwnerReportOptions): string {
  const lines = [
    `🧾 *Служебный отчёт* · ${digestDate(opts.date)}`,
    "",
    `Собрано: ${stats.collected} · отсеяно: ${stats.rejected} · опубликовано: ${stats.published}`,
  ];
  const dailyLimits = formatDailyLimits(stats);
  if (dailyLimits) lines.push(dailyLimits);
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
    const breakdown = formatStageBreakdown(stats.usage);
    if (breakdown) lines.push(breakdown);

    const limit = stats.dailyTokenBudget;
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      const spent = stats.usage.inputTokens + stats.usage.outputTokens;
      const remaining = Math.max(0, limit - spent);
      lines.push(`Бюджет токенов: ${spent} / ${limit} · остаток ${remaining}`);
      if (spent >= limit) {
        lines.push("⚠️ Дневной лимит токенов исчерпан — новые вызовы судьи остановлены.");
      }
    }
  }
  lines.push(`Причины отказа: ${formatReasons(stats.rejectedByReason)}`);
  if (stats.collected === 0) {
    lines.push("", "⚠️ Сбор пуст: за сутки не собрано ни одного материала.");
  } else if (stats.published === 0) {
    lines.push("", "⚠️ Публикаций нет: выпуск пустой.");
  }
  lines.push("");
  const errors = stats.errors ?? [];
  const notes = stats.notes ?? [];
  if (errors.length === 0 && notes.length === 0) {
    lines.push("Ошибок нет.");
  } else {
    if (errors.length > 0) {
      lines.push("⚠️ Ошибки:", ...errors.map((error) => `• ${esc(error)}`));
    }
    // Notes are deliberately shown separately: "2 материала не обработаны"
    // must not read like the alarm the owner used to get from a single hiccup.
    if (notes.length > 0) {
      if (errors.length > 0) lines.push("");
      lines.push("ℹ️ Замечания:", ...notes.map((note) => `• ${esc(note)}`));
    }
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
