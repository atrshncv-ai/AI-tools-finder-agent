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
 *   DIGEST_DASHBOARD_URL — dashboard base URL (default http://159.194.236.68:3000)
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
const DASHBOARD_URL = (process.env.DIGEST_DASHBOARD_URL || "http://159.194.236.68:3000").replace(/\/+$/, "");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
// Recipient list: TELEGRAM_CHAT_IDS (comma-separated) takes precedence; the
// legacy single-recipient TELEGRAM_CHAT_ID still works as a fallback.
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
  .split(",")
  .map((s) => s.trim())
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

function buildDigest(items: DigestItem[]): string {
  const videos = items.filter((i) => i.source?.startsWith("youtube-"));
  const science = items.filter((i) => !i.source?.startsWith("youtube-") && i.isScience);
  const tech = items.filter((i) => !i.source?.startsWith("youtube-") && !i.isScience);

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
    ...formatSection("🛠", "IT-инструменты", tech, false),
    ...formatSection("🔬", "Наука", science, false),
    `📊 [Открыть дашборд](${DASHBOARD_URL})`,
  ];

  let text = lines.join("\n");
  if (text.length > TELEGRAM_MAX_LEN) {
    text = text.slice(0, TELEGRAM_MAX_LEN - 40) + "\n\n… _(дайджест сокращён)_";
  }
  return text;
}

async function sendTelegram(text: string, chatId: string): Promise<boolean> {
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
    })
    .from(news)
    .where(and(eq(news.status, "published"), gte(news.updatedAt, since)))
    .orderBy(desc(news.updatedAt));

  console.error(`[daily-digest] ${items.length} published in last ${WINDOW_HOURS}h`);

  if (items.length === 0) {
    console.error("[daily-digest] nothing to report — skipping send");
    process.exit(0);
  }

  const digest = buildDigest(items);

  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.error("[daily-digest] STUB MODE (no TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_IDS) — printing digest:");
    console.log(digest);
    process.exit(0);
  }

  // Fan-out to every recipient; one failing chat must not block the others.
  let okCount = 0;
  for (const chatId of CHAT_IDS) {
    const ok = await sendTelegram(digest, chatId);
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
