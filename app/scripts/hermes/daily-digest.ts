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
import { hasExplicitAiSignal } from "../../api/lib/classify";
import { news } from "@db/schema";
import { and, desc, eq, gte, isNotNull, isNull, ne, not, inArray, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";

const WINDOW_HOURS = 24;
const MAX_ITEMS_PER_SECTION = 7;
const FALLBACK_ITEMS_PER_SECTION = 3;
const ARCHIVE_ITEMS_MAX = 5;
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
    lines.push(`▫️ ${esc(item.title)} (@url:\`${item.originalUrl}\`)${description}`);
  }
  if (items.length > MAX_ITEMS_PER_SECTION) {
    const themes = [...new Set(items.slice(MAX_ITEMS_PER_SECTION).flatMap((item) => item.sphereTags ?? []))].slice(0, 4);
    const themeText = themes.length > 0 ? ` про ${themes.join(", ")}` : " материалов по теме";
    lines.push(`Ещё ${items.length - MAX_ITEMS_PER_SECTION} новостей${themeText} — в дашборде.`);
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

export function buildDigest(items: DigestItem[], archiveItems: DigestItem[] = []): string {
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
    "",
    ...formatSection("🛠", "ИИ-новости", tech),
    ...formatSection("🔬", "ИИ для науки", science),
    ...formatSection("🧪", "Инструменты для изобретений", inventions),
  ];

  // Archive backfill is a separate labeled block: these are older picked
  // articles (rejected by the daily gate but strong), NOT part of the 24-hour
  // counters — mixing them into sections made digest counts diverge from the
  // dashboard.
  if (archiveItems.length > 0) {
    lines.push(`📚 *Из архива* — ${archiveItems.length} (в счётчики суток не входят)`);
    for (const item of archiveItems.slice(0, ARCHIVE_ITEMS_MAX)) {
      const description = item.summary ? ` — ${esc(item.summary.replace(/\s+/g, " ").trim().slice(0, 180))}` : "";
      lines.push(`▫️ ${esc(item.title)} (@url:\`${item.originalUrl}\`)${description}`);
    }
    lines.push("");
  }

  lines.push(`📊 Дашборд доступен по кнопке ниже`);
  return lines.join("\n");
}

async function sendTelegram(text: string, chatId: string): Promise<boolean> {
  try {
    // Plain-text dashboard URL inside the body: inline keyboards can be
    // missed at the bottom of long messages, but a tappable link in the text
    // itself always works (client reported "no dashboard button").
    const body = text.includes(DASHBOARD_URL) ? text : `${text}\n${DASHBOARD_URL}`;
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: body,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "📊 Открыть дашборд", url: DASHBOARD_URL }]],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(
        `[daily-digest] Telegram API error for chat ${chatId}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    // Network-level failure (DNS, reset, timeout) — must not abort the
    // fan-out to the remaining recipients.
    console.error(`[daily-digest] Telegram send to chat ${chatId} failed: ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000);

  // platformPublishedAt = immutable platform publication date (same field the
  // dashboard filters/sorts by, with the same MSK calendar window) — digest
  // and dashboard counts can never diverge again.
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
    .where(
      and(
        eq(news.status, "published"),
        gte(sql`coalesce(${news.platformPublishedAt}, ${news.updatedAt})`, since),
        nonEmptySummary,
      ),
    )
    .orderBy(desc(sql`coalesce(${news.platformPublishedAt}, ${news.updatedAt})`));

  // Backfill a few strong historical candidates per digest as a SEPARATE
    // archive block (not mixed into section counters). They are marked after a
    // successful send, so the archive is consumed over days and never
    // duplicates the current 24-hour feed.
    // IMPORTANT: only candidates that still carry an explicit AI signal may
    // appear — rejected non-AI rows (arxiv biology, nature news, etc.) must not
    // sneak back into the digest through the archive.
    const archiveCandidates = await db
      .select({
        id: news.id, title: news.title, originalUrl: news.originalUrl,
        source: news.source, isScience: news.isScience, section: news.section,
        sphereTags: news.sphereTags,
        summary: news.summary,
      })
      .from(news)
      .where(and(eq(news.status, "rejected"), gte(news.score, 50), isNull(news.digestArchiveSentAt), nonEmptySummary, sql`${news.source} NOT LIKE 'youtube-%'`, not(inArray(news.source, ["reddit-artificial", "reddit-localllama", "reddit-machinelearning"]))))
      .orderBy(desc(news.score), desc(news.updatedAt))
      .limit(30);
    const archiveItems = archiveCandidates
      .filter((item) => hasExplicitAiSignal(`${item.title} ${item.summary ?? ""}`))
      .slice(0, ARCHIVE_ITEMS_MAX);
    const items = [...recentItems];

  // NO fallback of older published articles into sections: the digest must
  // reflect strictly the last 24 hours (`since` window above). Empty sections
  // are simply omitted — per the owner's rule «пустые секции не отправлять».
  // (Previous fallback pulled articles from August 17 into a "24h" digest.)
  const present = new Set(items.map((item) => item.section));
  void present;

  // NOTE: invention-tools section has no fallback from the catalog.
  // If no fresh invention news exists the section simply does not appear
  // in the digest (per user requirement: only send sections with new items).

  console.error(`[daily-digest] ${items.length} published in last ${WINDOW_HOURS}h (+${archiveItems.length} from archive)`);

  const digestParts = items.length > 0
    ? splitTelegramText(buildDigest(items, archiveItems))
    : [];

  // Fan-out to every recipient; one failing chat must not block the others.
  let okCount = 0;
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.error("[daily-digest] STUB MODE (no TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_IDS) — printing digest:");
    if (digestParts.length > 0) console.log(digestParts.join("\n---\n"));
  } else {
    for (const chatId of CHAT_IDS) {
      let ok = true;
      for (const part of digestParts) ok = (await sendTelegram(part, chatId)) && ok;
      console.error(`[daily-digest] → chat ${chatId}: ${ok ? "sent" : "FAILED"}`);
      if (ok) okCount++;
    }
    console.log(JSON.stringify({ status: okCount === CHAT_IDS.length ? "sent" : "partial", items: items.length, recipients: { ok: okCount, total: CHAT_IDS.length } }));
  }

  if (PAYMENT_MANAGER_CHAT_ID && isPaymentReminderDay(new Date())) {
    const reminderOk = !BOT_TOKEN || (await sendTelegram(paymentReminderText(), PAYMENT_MANAGER_CHAT_ID));
    console.error(`[daily-digest] payment reminder → manager: ${reminderOk ? "sent" : "FAILED"}`);
  }
  // Mark archive items as consumed ONLY when the digest actually reached at
  // least one recipient: a failed fan-out (e.g. Telegram 400 on malformed
  // Markdown) must not silently burn the archive pool.
  if (archiveItems.length > 0 && okCount > 0) {
    await db.update(news).set({ digestArchiveSentAt: new Date() }).where(inArray(news.id, archiveItems.map((item) => item.id)));
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
