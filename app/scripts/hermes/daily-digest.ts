#!/usr/bin/env tsx
/**
 * daily-digest.ts — Morning Telegram digest of everything published in the
 * last 24 hours.
 *
 * Two audiences, two messages (R11, R17i):
 *   - clients get ONLY `buildClientDigest` output: the approved form, no
 *     pipeline-health line, no error codes, no funnel counters;
 *   - the owner gets a copy of the same clean digest plus a separate service
 *     report (`buildOwnerReport`) with counters, rejection reasons and errors.
 * The owner report goes out first, so a broken release reaches the owner
 * before it reaches the client (R17).
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN — when absent the digest is only printed to stdout
 *     (stub mode, no sending).
 *   TELEGRAM_CLIENT_CHAT_IDS — comma-separated client recipients. Legacy
 *     TELEGRAM_CHAT_IDS / TELEGRAM_CHAT_ID are honoured as a client fallback.
 *   TELEGRAM_OWNER_CHAT_IDS — comma-separated owner recipients: a copy of the
 *     clean digest plus the service report. Missing owner address does not
 *     stop the client delivery.
 *   DIGEST_DASHBOARD_URL — dashboard base URL (default http://localhost:3000).
 *   PAYMENT_MANAGER_CHAT_ID / PAYMENT_DUE_AT — server-payment reminders.
 *
 * Usage:
 *   npx tsx scripts/hermes/daily-digest.ts
 */

import "dotenv/config";

import { getDb } from "../../api/queries/connection";
import { collectPipelineStats, formatHealthLine, type PipelineStats } from "./pipeline-health";
import {
  buildClientDigest,
  buildEmptyClientDigest,
  buildOwnerReport,
  DIGEST_WINDOW_HOURS,
  splitTelegramText,
  type CycleStats,
  type DigestItem,
} from "./digest-format";
import { news } from "@db/schema";
import { and, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import {
  cycleIdFor,
  emptyCycleMetrics,
  readCycle,
  type CycleMetrics,
  type UsageTotals,
} from "./publish-budget";

const DASHBOARD_URL = (process.env.DIGEST_DASHBOARD_URL || "http://localhost:3000").replace(/\/+$/, "");
const nonEmptySummary = and(isNotNull(news.summary), ne(news.summary, ""));
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const PAYMENT_MANAGER_CHAT_ID = (process.env.PAYMENT_MANAGER_CHAT_ID || "").trim();
const PAYMENT_DUE_AT = process.env.PAYMENT_DUE_AT || "2026-11-10";

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
function parseChatIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
}

/**
 * Client and owner recipients come from separate variables. The legacy shared
 * TELEGRAM_CHAT_IDS / TELEGRAM_CHAT_ID list stays a client fallback, so an
 * existing deployment keeps delivering; the owner copy is opt-in.
 */
export function resolveRecipients(env: NodeJS.ProcessEnv = process.env): DigestRecipients {
  return {
    client: parseChatIds(
      env.TELEGRAM_CLIENT_CHAT_IDS || env.TELEGRAM_CHAT_IDS || env.TELEGRAM_CHAT_ID,
    ),
    owner: parseChatIds(env.TELEGRAM_OWNER_CHAT_IDS || env.TELEGRAM_OWNER_CHAT_ID),
  };
}

interface MetricsRecord {
  decision?: unknown;
  judge?: { onTopic?: unknown; reason?: unknown } | null;
}

/** Judge reasons that are machine codes; any other judge reason is free text. */
const JUDGE_REASON_CODES = new Set(["invalid-judgement", "low-confidence"]);

/**
 * Why a material was rejected, as a stable machine code for the owner report:
 * a judge rejection becomes `off-topic` (or its own code), else the
 * evaluator's decision code. The judge's free-text reason is deliberately not
 * used — every rejected item would get its own bucket and "top-3" would lie.
 */
function rejectionReason(metrics: unknown): string | null {
  if (!metrics || typeof metrics !== "object") return null;
  const record = metrics as MetricsRecord;
  const judge = record.judge;
  if (judge && judge.onTopic === false) {
    const reason = typeof judge.reason === "string" ? judge.reason.trim() : "";
    return JUDGE_REASON_CODES.has(reason) ? reason : "off-topic";
  }
  if (typeof record.decision === "string" && record.decision.trim()) return record.decision.trim();
  return null;
}

/** Rejected-in-window count and the reason histogram for the owner report. */
async function collectRejectionStats(
  db: ReturnType<typeof getDb>,
  since: Date,
): Promise<{ rejected: number; reasons: Record<string, number> }> {
  const rows = await db
    .select({ metrics: news.metrics })
    .from(news)
    .where(and(eq(news.status, "rejected"), gte(news.updatedAt, since)));
  const reasons: Record<string, number> = {};
  for (const row of rows) {
    const reason = rejectionReason(row.metrics);
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return { rejected: rows.length, reasons };
}

/**
 * Funnel, rejection split, token spend and provider errors of the day's cycle,
 * read from `pipeline_state.metrics` (R13, R18). This is the ledger the cycle
 * itself wrote, so the report never invents numbers: the dead
 * `rejectedByPrefilter` / `rejectedByJudge` fields get real values, and every
 * `provider:<class>` counter becomes a named provider error for the owner.
 */
export interface OwnerCycleFields {
  collected: number;
  rejectedByPrefilter: number;
  rejectedByJudge: number;
  usage: UsageTotals;
  providerErrors: string[];
}

export function ownerStatsFromCycle(metrics: CycleMetrics): OwnerCycleFields {
  let rejectedByPrefilter = 0;
  let rejectedByJudge = 0;
  const providerErrors: string[] = [];
  for (const [reason, count] of Object.entries(metrics.rejectedByReason)) {
    if (reason.startsWith("prefilter:")) rejectedByPrefilter += count;
    else if (reason.startsWith("judge:")) rejectedByJudge += count;
    else if (reason.startsWith("provider:")) {
      const errorClass = reason.slice("provider:".length);
      if (!providerErrors.includes(errorClass)) providerErrors.push(errorClass);
    }
  }
  return {
    collected: metrics.collected,
    rejectedByPrefilter,
    rejectedByJudge,
    usage: metrics.usage,
    providerErrors: providerErrors.sort(),
  };
}

const SEND_MAX_ATTEMPTS = 3;
// Backoff between attempts (after attempt 1, 2): a cold TLS connection from a
// fresh cron process to api.telegram.org often fails once with a network-level
// `fetch failed`/timeout while the API itself is healthy.
const SEND_BACKOFF_MS = [2_000, 4_000];
// Pacing between recipients/parts to avoid burst throttling (cron job, not
// latency-sensitive).
const SEND_PACE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function causeCode(err: unknown): string | undefined {
  const cause = (err as { cause?: unknown } | null)?.cause as { code?: unknown } | null | undefined;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

export async function sendTelegram(text: string, chatId: string): Promise<boolean> {
  // Plain-text dashboard URL inside the body: inline keyboards can be
  // missed at the bottom of long messages, but a tappable link in the text
  // itself always works (client reported "no dashboard button").
  const body = text.includes(DASHBOARD_URL) ? text : `${text}\n${DASHBOARD_URL}`;
  const payload = JSON.stringify({
    chat_id: chatId,
    text: body,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "📊 Открыть дашборд", url: DASHBOARD_URL }]],
    },
  });
  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
    const last = attempt === SEND_MAX_ATTEMPTS;
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      const retryable = res.status === 429 || res.status >= 500;
      let snippet: string;
      try {
        snippet = (await res.text()).slice(0, 300);
      } catch {
        snippet = "<unreadable body>";
      }
      console.error(
        `[daily-digest] Telegram attempt ${attempt}/${SEND_MAX_ATTEMPTS} for chat ${chatId} failed: HTTP ${res.status} ${snippet}${retryable && !last ? ` — retrying in ${SEND_BACKOFF_MS[attempt - 1]}ms` : ""}`,
      );
      // Non-retryable client errors (e.g. 400 bad request) fail fast.
      if (!retryable || last) return false;
    } catch (err) {
      // Network-level failure (DNS, reset, timeout) — retry with backoff.
      const msg = (err as Error)?.message ?? String(err);
      const code = causeCode(err);
      console.error(
        `[daily-digest] Telegram attempt ${attempt}/${SEND_MAX_ATTEMPTS} to chat ${chatId} failed: ${msg}${code ? ` (cause ${code})` : ""}${!last ? ` — retrying in ${SEND_BACKOFF_MS[attempt - 1]}ms` : ""}`,
      );
      if (last) return false;
    }
    await sleep(SEND_BACKOFF_MS[attempt - 1] ?? 0);
  }
  return false;
}

interface DeliveryResult {
  ok: number;
  total: number;
}

/** Send every part to every chat; one failing chat never blocks the others. */
async function sendParts(parts: string[], chatIds: string[]): Promise<DeliveryResult> {
  let okCount = 0;
  for (let ci = 0; ci < chatIds.length; ci++) {
    const chatId = chatIds[ci];
    let ok = true;
    for (let pi = 0; pi < parts.length; pi++) {
      ok = (await sendTelegram(parts[pi], chatId)) && ok;
      if (pi < parts.length - 1) await sleep(SEND_PACE_MS);
    }
    console.error(`[daily-digest] → chat ${chatId}: ${ok ? "sent" : "FAILED"}`);
    if (ok) okCount++;
    if (ci < chatIds.length - 1) await sleep(SEND_PACE_MS);
  }
  return { ok: okCount, total: chatIds.length };
}

async function main() {
  const db = getDb();
  const since = new Date(Date.now() - DIGEST_WINDOW_HOURS * 3600_000);

  // platformPublishedAt is immutable; updatedAt may change during enrichment.
  const recentItems = await db
    .select({
      id: news.id,
      title: news.title,
      originalUrl: news.originalUrl,
      source: news.source,
      isScience: news.isScience,
      section: news.section,
      sphereTags: news.sphereTags,
      summary: news.summary,
    })
    .from(news)
    .where(and(eq(news.status, "published"), sql`coalesce(${news.platformPublishedAt}, ${news.updatedAt}) >= ${since.toISOString()}`, nonEmptySummary))
    .orderBy(desc(sql`coalesce(${news.platformPublishedAt}, ${news.updatedAt})`));

  const items: DigestItem[] = [...recentItems];
  console.error(`[daily-digest] ${items.length} published in last ${DIGEST_WINDOW_HOURS}h`);

  const now = new Date();
  const recipients = resolveRecipients();
  const envErrors: string[] = [];

  let healthStats: PipelineStats | undefined;
  let healthLine: string | undefined;
  try {
    healthStats = await collectPipelineStats(since);
    healthLine = formatHealthLine(healthStats);
  } catch (err) {
    const message = (err as Error).message.slice(0, 120);
    console.error(`[daily-digest] health line skipped: ${message}`);
    // Fixed class only: DB/provider errors can echo connection details.
    envErrors.push("статистика конвейера недоступна");
  }

  let rejected = 0;
  let rejectedByReason: Record<string, number> = {};
  try {
    ({ rejected, reasons: rejectedByReason } = await collectRejectionStats(db, since));
  } catch (err) {
    console.error(`[daily-digest] rejection stats skipped: ${(err as Error).message.slice(0, 120)}`);
    envErrors.push("причины отказа недоступны");
  }

  // The day's ledger written by the cycle (evaluate-news / save-summary): the
  // funnel, the prefilter/judge split and the token spend come from here, not
  // from a second, differently-derived count (R13, R18).
  let cycleMetrics: CycleMetrics = emptyCycleMetrics();
  try {
    cycleMetrics = (await readCycle(cycleIdFor(now)))?.metrics ?? emptyCycleMetrics();
  } catch (err) {
    console.error(`[daily-digest] cycle metrics skipped: ${(err as Error).message.slice(0, 120)}`);
    envErrors.push("счётчики цикла недоступны");
  }
  const cycleFields = ownerStatsFromCycle(cycleMetrics);

  if (recipients.client.length === 0) {
    envErrors.push("нет клиентских chat_id — клиентский дайджест некому отправить");
  }

  const stats: CycleStats = {
    collected: cycleFields.collected > 0 ? cycleFields.collected : (healthStats?.collected ?? items.length),
    rejected,
    published: items.length,
    rejectedByPrefilter: cycleFields.rejectedByPrefilter,
    rejectedByJudge: cycleFields.rejectedByJudge,
    rejectedByReason,
    usage: cycleFields.usage,
    errors: [
      ...envErrors,
      ...cycleFields.providerErrors.map(
        (errorClass) => `ошибка провайдера: ${errorClass} — кандидаты остались pending`,
      ),
    ],
  };
  const report = buildOwnerReport(stats, { date: now, dashboardUrl: DASHBOARD_URL, healthLine });
  const clientParts = splitTelegramText(
    items.length > 0
      ? buildClientDigest(items, { date: now, dashboardUrl: DASHBOARD_URL })
      : buildEmptyClientDigest({ date: now, dashboardUrl: DASHBOARD_URL }),
  );

  if (!BOT_TOKEN || (recipients.client.length === 0 && recipients.owner.length === 0)) {
    console.error("[daily-digest] STUB MODE (no TELEGRAM_BOT_TOKEN / recipients) — printing messages:");
    console.log(
      [
        "=== КЛИЕНТСКОЕ СООБЩЕНИЕ ===",
        ...clientParts,
        "",
        "=== СЛУЖЕБНЫЙ ОТЧЁТ ВЛАДЕЛЬЦУ ===",
        report,
      ].join("\n"),
    );
  } else {
    // Owner first: a broken release must reach the owner before the client (R17).
    let reportOk = false;
    if (recipients.owner.length > 0) {
      const reportDelivery = await sendParts(splitTelegramText(report), recipients.owner);
      reportOk = reportDelivery.ok === reportDelivery.total;
      console.error(`[daily-digest] owner report → ${reportDelivery.ok}/${reportDelivery.total}`);
    } else {
      console.error("[daily-digest] no TELEGRAM_OWNER_CHAT_IDS — service report is not delivered");
    }

    const clientDelivery: DeliveryResult =
      recipients.client.length > 0 ? await sendParts(clientParts, recipients.client) : { ok: 0, total: 0 };
    // The owner's id may also be listed among clients; sending the copy again
    // would duplicate the message, so only the missing ids get it.
    const copyIds = recipients.owner.filter((id) => !recipients.client.includes(id));
    const copyDelivery: DeliveryResult =
      copyIds.length > 0 ? await sendParts(clientParts, copyIds) : { ok: 0, total: 0 };

    const clientOk = clientDelivery.total > 0 && clientDelivery.ok === clientDelivery.total;
    const ownerOk =
      recipients.owner.length === 0 || (reportOk && copyDelivery.ok === copyDelivery.total);
    const delivered = clientDelivery.ok + copyDelivery.ok;
    const status = clientOk && ownerOk ? "sent" : delivered > 0 || reportOk ? "partial" : "failed";
    console.log(
      JSON.stringify({
        status,
        items: items.length,
        recipients: {
          client: { ok: clientDelivery.ok, total: clientDelivery.total },
          ownerCopy: { ok: copyDelivery.ok, total: copyDelivery.total },
        },
        ownerReport: recipients.owner.length === 0 ? "skipped" : reportOk ? "sent" : "failed",
      }),
    );
    // Total client-delivery failure (or no client recipients at all) must be
    // visible in the cron log.
    if (!clientOk) process.exit(1);
  }

  if (PAYMENT_MANAGER_CHAT_ID && isPaymentReminderDay(new Date())) {
    const reminderOk = !BOT_TOKEN || (await sendTelegram(paymentReminderText(), PAYMENT_MANAGER_CHAT_ID));
    console.error(`[daily-digest] payment reminder → manager: ${reminderOk ? "sent" : "FAILED"}`);
  }
  process.exit(0);
}

export function isPaymentReminderDay(now: Date, dueAt = PAYMENT_DUE_AT): boolean {
  const due = new Date(`${dueAt}T00:00:00Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  return days === -88 || (days >= 0 && days % 30 === 0);
}

export function paymentReminderText(dueAt = PAYMENT_DUE_AT): string {
  return `💳 *Напоминание об оплате сервера*\n\nПожалуйста, проверьте оплату сервера. Текущий ориентир окончания оплаченного периода: *${dueAt}*.\n\nПосле этой даты напоминание будет приходить каждые 30 дней.`;
}

/**
 * Best-effort owner alert when the digest cannot be built at all (R17: the
 * owner learns about a failure before the client). The error text itself is
 * never sent — it can contain connection details or credentials.
 */
async function alertOwnerOfFailure(): Promise<void> {
  const owner = resolveRecipients().owner;
  if (!BOT_TOKEN || owner.length === 0) return;
  const text = [
    "🧾 *Служебный отчёт* · сбой дайджеста",
    "",
    "⚠️ Дайджест не собран: скрипт завершился с ошибкой.",
    "Клиенту сообщение не отправлено. Подробности — в логе cron.",
  ].join("\n");
  for (const chatId of owner) await sendTelegram(text, chatId);
}

// Run only when executed as a script (tsx scripts/hermes/daily-digest.ts),
// not when imported by tests for resolveRecipients/sendTelegram.
const invokedAsScript =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch(async (err) => {
    console.error("[daily-digest] Fatal error:", err);
    await alertOwnerOfFailure().catch(() => {});
    process.exit(1);
  });
}
