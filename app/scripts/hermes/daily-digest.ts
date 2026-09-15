#!/usr/bin/env tsx
/**
 * daily-digest.ts — Morning Telegram digest of everything published in the
 * last 24 hours.
 *
 * Sections: 🎬 YouTube videos, 🛠 Tech (GitHub/HN/RSS blogs), 🔬 Science.
 * Each item links to its original source; the footer links to the dashboard.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS — when absent the digest is only
 *     printed to stdout (stub mode, no sending).
 *   TELEGRAM_CHAT_IDS — comma-separated list of recipient chat IDs (owner +
 *     client). Legacy single TELEGRAM_CHAT_ID is honored as a fallback.
 *   DIGEST_DASHBOARD_URL — dashboard base URL (default http://localhost:3000)
 *
 * Usage:
 *   npx tsx scripts/hermes/daily-digest.ts
 */

import "dotenv/config";

import { getDb } from "../../api/queries/connection";
import { collectPipelineStats, formatHealthLine } from "./pipeline-health";
import { news } from "@db/schema";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";

const WINDOW_HOURS = 24;
const MAX_ITEMS_PER_SECTION = 7;
const TELEGRAM_MAX_LEN = 4000;
const DASHBOARD_URL = (process.env.DIGEST_DASHBOARD_URL || "http://localhost:3000").replace(/\/+$/, "");
const nonEmptySummary = and(isNotNull(news.summary), ne(news.summary, ""));
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
// Recipient list: TELEGRAM_CHAT_IDS (comma-separated) takes precedence; the
// legacy single-recipient TELEGRAM_CHAT_ID still works as a fallback.
// Surrounding quotes are stripped per id: cron sources .env via bash
// (`set -a; . ./.env`), which — unlike dotenv — keeps literal quotes, and a
// quoted id makes Telegram reject the chat ("chat not found").
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
  .split(",")
  .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
  .filter(Boolean);
const PAYMENT_MANAGER_CHAT_ID = (process.env.PAYMENT_MANAGER_CHAT_ID || "").trim();
const PAYMENT_DUE_AT = process.env.PAYMENT_DUE_AT || "2026-11-10";

/** Telegram legacy-Markdown escaping for dynamic text. */
function esc(text: string): string {
  return text.replace(/([_*\[\]`])/g, "\\$1");
}

interface DigestItem {
  id: number;
  title: string;
  originalUrl: string;
  source: string | null;
  isScience: boolean | null;
  section: string;
  sphereTags: string[];
  summary?: string | null;
}

function formatSection(emoji: string, name: string, items: DigestItem[]): string[] {
  if (items.length === 0) return [];
  const lines = [`${emoji} *${name}* — ${items.length}`];
  for (const item of items.slice(0, MAX_ITEMS_PER_SECTION)) {
    const description = item.summary ? ` — ${esc(item.summary.replace(/\s+/g, " ").trim().slice(0, 180))}` : "";
    lines.push(`▫️ [${esc(item.title)}](${item.originalUrl})${description}`);
  }
  if (items.length > MAX_ITEMS_PER_SECTION) {
    lines.push(`Ещё ${items.length - MAX_ITEMS_PER_SECTION} материалов — в дашборде.`);
  }
  lines.push("");
  return lines;
}

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

export function isPaymentReminderDay(now: Date, dueAt = PAYMENT_DUE_AT): boolean {
  const due = new Date(`${dueAt}T00:00:00Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
  return days === -88 || (days >= 0 && days % 30 === 0);
}

export function paymentReminderText(dueAt = PAYMENT_DUE_AT): string {
  return `💳 *Напоминание об оплате сервера*\n\nПожалуйста, проверьте оплату сервера. Текущий ориентир окончания оплаченного периода: *${dueAt}*.\n\nПосле этой даты напоминание будет приходить каждые 30 дней.`;
}

export function buildDigest(items: DigestItem[], healthLine?: string): string {
  const science = items.filter((i) => i.section === "science" || (!i.section && i.isScience));
  const inventions = items.filter((i) => i.section === "invention-tools");
  const tech = items.filter((i) => i.section === "ai-news" || (!i.section && !i.isScience));

  const dateStr = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });

  const lines = [
    `🌅 *Утренний дайджест научного агента*`,
    `_${dateStr}_`,
    "",
    `За последние ${WINDOW_HOURS} часа опубликовано: *${items.length}*`,
  ];
  if (healthLine) lines.push(healthLine);
  lines.push(
    "",
    ...formatSection("🛠", "ИИ-новости", tech),
    ...formatSection("🔬", "ИИ для науки", science),
    ...formatSection("🧪", "Инструменты для изобретений", inventions),
  );
  lines.push(`📊 Дашборд доступен по кнопке ниже`);
  return lines.join("\n");
}

/**
 * Heartbeat for an empty day: the bot must NEVER be silent — a missing digest
 * is indistinguishable from a broken cron/pipeline. An explicit "nothing
 * published" message turns silence back into a diagnosable signal.
 */
export function buildEmptyDigest(): string {
  const dateStr = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });
  return [
    `🌅 *Утренний дайджест научного агента*`,
    `_${dateStr}_`,
    "",
    `За последние ${WINDOW_HOURS} часа новых публикаций нет — конвейер работает, свежих материалов не нашлось.`,
    "",
    `📊 Дашборд доступен по кнопке ниже`,
  ].join("\n");
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

async function main() {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000);

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

  const items = [...recentItems];
  console.error(`[daily-digest] ${items.length} published in last ${WINDOW_HOURS}h`);

  let healthLine: string | undefined;
  try {
    healthLine = formatHealthLine(await collectPipelineStats(since));
  } catch (err) {
    console.error(`[daily-digest] health line skipped: ${(err as Error).message.slice(0, 120)}`);
  }

  const digestParts = items.length > 0
    ? splitTelegramText(buildDigest(items, healthLine))
    : [buildEmptyDigest()];

  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.error("[daily-digest] STUB MODE (no TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_IDS) — printing digest:");
    console.log(digestParts.join("\n---\n"));
  } else {
    // Fan-out to every recipient; one failing chat must not block the others.
    // Small pacing between parts/recipients avoids burst throttling.
    let okCount = 0;
    for (let ci = 0; ci < CHAT_IDS.length; ci++) {
      const chatId = CHAT_IDS[ci];
      let ok = true;
      for (let pi = 0; pi < digestParts.length; pi++) {
        ok = (await sendTelegram(digestParts[pi], chatId)) && ok;
        if (pi < digestParts.length - 1) await sleep(SEND_PACE_MS);
      }
      console.error(`[daily-digest] → chat ${chatId}: ${ok ? "sent" : "FAILED"}`);
      if (ok) okCount++;
      if (ci < CHAT_IDS.length - 1) await sleep(SEND_PACE_MS);
    }
    const status = okCount === CHAT_IDS.length ? "sent" : okCount > 0 ? "partial" : "failed";
    console.log(JSON.stringify({ status, items: items.length, recipients: { ok: okCount, total: CHAT_IDS.length } }));
    // Total delivery failure must be visible in the cron log (non-zero exit).
    if (okCount === 0) process.exit(1);
  }

  if (PAYMENT_MANAGER_CHAT_ID && isPaymentReminderDay(new Date())) {
    const reminderOk = !BOT_TOKEN || (await sendTelegram(paymentReminderText(), PAYMENT_MANAGER_CHAT_ID));
    console.error(`[daily-digest] payment reminder → manager: ${reminderOk ? "sent" : "FAILED"}`);
  }
  process.exit(0);
}

// Run only when executed as a script (tsx scripts/hermes/daily-digest.ts),
// not when imported by tests for buildDigest/splitTelegramText.
const invokedAsScript =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[daily-digest] Fatal error:", err);
    process.exit(1);
  });
}
