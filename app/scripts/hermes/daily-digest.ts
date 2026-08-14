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
import { news } from "@db/schema";
import { and, desc, eq, gte } from "drizzle-orm";

const WINDOW_HOURS = 24;
const MAX_ITEMS_PER_SECTION = 15;
const TELEGRAM_MAX_LEN = 4000;
const DASHBOARD_URL = (process.env.DIGEST_DASHBOARD_URL || "http://localhost:3000").replace(/\/+$/, "");
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

/** Telegram legacy-Markdown escaping for dynamic text. */
function esc(text: string): string {
  return text.replace(/([_*\[\]`])/g, "\\$1");
}

function channelName(source: string | null): string {
  if (!source) return "";
  return source
    .replace(/^youtube-/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface DigestItem {
  id: number;
  title: string;
  originalUrl: string;
  source: string | null;
  isScience: boolean | null;
  section: string;
  sphereTags: string[];
}

function formatSection(emoji: string, name: string, items: DigestItem[], withChannel: boolean): string[] {
  if (items.length === 0) return [];
  const lines = [`${emoji} *${name}* — ${items.length}`];
  for (const item of items.slice(0, MAX_ITEMS_PER_SECTION)) {
    const via = withChannel && item.source ? ` — _${esc(channelName(item.source))}_` : "";
    lines.push(`▫️ [${esc(item.title)}](${item.originalUrl})${via}`);
  }
  if (items.length > MAX_ITEMS_PER_SECTION) {
    lines.push(`…и ещё ${items.length - MAX_ITEMS_PER_SECTION}`);
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
    if (cut < 200) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function buildDigest(items: DigestItem[]): string {
  const videos = items.filter((i) => i.source?.startsWith("youtube-"));
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
    ...formatSection("🎬", "Видео с YouTube", videos, true),
    ...formatSection("🛠", "ИИ-новости", tech, false),
    ...formatSection("🔬", "Наука", science, false),
    ...formatSection("🧪", "Инструменты для изобретений", inventions, false),
    `📊 [Открыть дашборд](${DASHBOARD_URL})`,
  ];

  return lines.join("\n");
}

async function sendTelegram(text: string, chatId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
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

  // updatedAt approximates "when WE published it" (publishedAt is the source date).
  const items = await db
    .select({
      id: news.id,
      title: news.title,
      originalUrl: news.originalUrl,
      source: news.source,
      isScience: news.isScience,
      section: news.section,
      sphereTags: news.sphereTags,
    })
    .from(news)
    .where(and(eq(news.status, "published"), gte(news.updatedAt, since)))
    .orderBy(desc(news.updatedAt));

  console.error(`[daily-digest] ${items.length} published in last ${WINDOW_HOURS}h`);

  if (items.length === 0) {
    console.error("[daily-digest] nothing to report — skipping send");
    process.exit(0);
  }

  const digestParts = splitTelegramText(buildDigest(items));

  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.error("[daily-digest] STUB MODE (no TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_IDS) — printing digest:");
    console.log(digest);
    process.exit(0);
  }

  // Fan-out to every recipient; one failing chat must not block the others.
  let okCount = 0;
  for (const chatId of CHAT_IDS) {
    let ok = true;
    for (const part of digestParts) ok = (await sendTelegram(part, chatId)) && ok;
    console.error(`[daily-digest] → chat ${chatId}: ${ok ? "sent" : "FAILED"}`);
    if (ok) okCount++;
  }

  const status = okCount === CHAT_IDS.length ? "sent" : okCount > 0 ? "partial" : "failed";
  console.log(
    JSON.stringify({ status, items: items.length, recipients: { ok: okCount, total: CHAT_IDS.length } }),
  );
  process.exit(okCount > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[daily-digest] Fatal error:", err);
  process.exit(1);
});
