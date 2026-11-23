#!/usr/bin/env tsx
/**
 * telegram-subscribe.ts — «Запустить» у бота: the new subscriber gets today's
 * release right away instead of waiting for the 09:00 MSK digest.
 *
 * Telegram does not push anything to a bot that has no webhook, so this cron
 * job short-polls `getUpdates` (timeout=0, no long polling): an update above
 * the stored offset is a chat that has just written to the bot (/start or any
 * message). Every such chat is stored as a subscriber and — unless it already
 * receives the daily digest from TELEGRAM_CLIENT_CHAT_IDS /
 * TELEGRAM_OWNER_CHAT_IDS — gets a two-line greeting plus today's client
 * digest (`buildClientDigest`, the same 24-hour selection `daily-digest.ts`
 * sends). No publications in the window: greeting only.
 *
 * Idempotency is the offset. `agent_state` row `telegram-subscribe` stores
 * `{offset, subscribers: [{chatId, name, joinedAt}]}` (status=JSON) and the
 * state is written BEFORE any message goes out, so a repeat run — or a crash
 * between the greeting and the digest — never welcomes the same chat twice.
 * A failed send is logged and the loop continues with the next chat.
 *
 * Subscribers are not env: `.env` is edited and rewritten by hand, so the list
 * lives in the database; `resolveRecipients` in `digest-format.ts` merges it
 * with the env lists for the morning digest.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN — required to poll and send.
 *   TELEGRAM_CLIENT_CHAT_IDS / TELEGRAM_OWNER_CHAT_IDS — chats that already
 *     get the morning digest; they are recorded but not greeted.
 *   DIGEST_DASHBOARD_URL — dashboard link on the inline button.
 *
 * Usage:
 *   npx tsx scripts/hermes/telegram-subscribe.ts
 *
 * Cron: run from `app/` every five minutes (a line in
 * `scripts/deploy/cron.sh`); a tick with no updates exits before it loads the
 * digest query.
 */

import "dotenv/config";

import { pathToFileURL } from "node:url";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { agentState, news } from "@db/schema";
import { instantParam, platformPublishedAtSql } from "../../api/queries/newsDateRules";
import { getDb } from "../../api/queries/connection";
import {
  buildClientDigest,
  DIGEST_WINDOW_HOURS,
  resolveRecipients,
  splitTelegramText,
  type DigestItem,
} from "./digest-format";
import { sendTelegramMessageDetailed, type TelegramSendOptions } from "./telegram-send";

/** `agent_state.agentId` of the subscription row. */
export const SUBSCRIBER_AGENT_ID = "telegram-subscribe";
/** One `getUpdates` response is capped, the rest arrives on the next tick. */
export const MAX_UPDATES_PER_RUN = 100;
const API_TIMEOUT_MS = 10_000;

/**
 * Two lines in the project's voice. It deliberately does not promise that a
 * digest follows: an empty day sends the greeting alone.
 */
export const WELCOME_TEXT = [
  "👋 *Добро пожаловать в научный агент!*",
  "Каждое утро в 09:00 МСК здесь выходит свежий дайджест ИИ-новостей.",
].join("\n");

export interface Subscriber {
  chatId: string;
  name: string;
  /** ISO timestamp of the first message that made the chat a subscriber. */
  joinedAt: string;
}

export interface SubscriptionState {
  /** `update_id + 1` of the last handled update; the next `getUpdates` offset. */
  offset: number;
  subscribers: Subscriber[];
}

/** The row has never been written (or holds the schema default "idle"). */
export function emptySubscriptionState(): SubscriptionState {
  return { offset: 0, subscribers: [] };
}

export function serializeSubscriptionState(state: SubscriptionState): string {
  return JSON.stringify({ offset: state.offset, subscribers: state.subscribers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanChatId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/**
 * Read the stored row defensively: a fresh row carries the schema default
 * "idle", a half-written value must not crash the welcome flow — both fall
 * back to an empty state instead of throwing.
 */
export function parseSubscriptionState(raw: unknown): SubscriptionState {
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return emptySubscriptionState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySubscriptionState();
  }
  if (!isRecord(parsed)) return emptySubscriptionState();

  const offset =
    typeof parsed.offset === "number" && Number.isInteger(parsed.offset) && parsed.offset > 0
      ? parsed.offset
      : 0;

  const subscribers: Subscriber[] = [];
  const seen = new Set<string>();
  if (Array.isArray(parsed.subscribers)) {
    for (const entry of parsed.subscribers) {
      if (!isRecord(entry)) continue;
      const chatId = cleanChatId(entry.chatId);
      if (!chatId || seen.has(chatId)) continue;
      seen.add(chatId);
      const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : chatId;
      subscribers.push({
        chatId,
        name: name.slice(0, 120),
        joinedAt:
          typeof entry.joinedAt === "string" && entry.joinedAt.trim()
            ? entry.joinedAt
            : new Date().toISOString(),
      });
    }
  }
  return { offset, subscribers };
}

type Db = ReturnType<typeof getDb>;

export async function loadSubscriptionState(db: Db = getDb()): Promise<SubscriptionState> {
  const rows = await db
    .select({ status: agentState.status })
    .from(agentState)
    .where(eq(agentState.agentId, SUBSCRIBER_AGENT_ID))
    .limit(1);
  return parseSubscriptionState(rows[0]?.status);
}

export async function saveSubscriptionState(
  state: SubscriptionState,
  db: Db = getDb(),
): Promise<void> {
  const status = serializeSubscriptionState(state);
  const now = new Date();
  await db
    .insert(agentState)
    .values({ agentId: SUBSCRIBER_AGENT_ID, status, lastRun: now, updatedAt: now })
    .onConflictDoUpdate({
      target: agentState.agentId,
      set: { status, lastRun: now, updatedAt: now },
    });
}

/** The subset of a `getUpdates` entry this job needs. */
export interface TelegramChat {
  id?: number | string | null;
  first_name?: string | null;
  username?: string | null;
  title?: string | null;
}

export interface TelegramUser {
  first_name?: string | null;
  username?: string | null;
}

export interface TelegramMessage {
  chat?: TelegramChat | null;
  from?: TelegramUser | null;
  text?: string | null;
}

export interface TelegramUpdate {
  update_id?: number | null;
  message?: TelegramMessage | null;
}

export interface SubscriptionPlan {
  /** State to persist: the advanced offset and every subscriber seen. */
  state: SubscriptionState;
  /** New chats that do not receive the digest yet — greet them. */
  welcomed: Subscriber[];
  /** New chats already listed in env — stored, but no welcome (no second copy). */
  known: Subscriber[];
}

export interface PlanSubscriptionsInput {
  state: SubscriptionState;
  updates: readonly TelegramUpdate[];
  /** chat_ids that already get the daily digest from env. */
  knownChatIds?: readonly string[];
  now?: Date;
}

function updateId(update: TelegramUpdate): number | null {
  const id = update.update_id;
  return typeof id === "number" && Number.isInteger(id) && id >= 0 ? id : null;
}

function chatIdOf(update: TelegramUpdate): string | null {
  return cleanChatId(update.message?.chat?.id);
}

function displayName(update: TelegramUpdate, chatId: string): string {
  const message = update.message;
  const candidates = [
    message?.from?.first_name,
    message?.chat?.first_name,
    message?.from?.username,
    message?.chat?.username,
    message?.chat?.title,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 120);
  }
  return chatId;
}

/**
 * Turn a batch of updates into the next state. Pure: no I/O, so the idempotency
 * rule (an update at or below the offset is already handled) is testable
 * without Telegram or the database.
 */
export function planSubscriptions(input: PlanSubscriptionsInput): SubscriptionPlan {
  const known = new Set((input.knownChatIds ?? []).map((id) => id.trim()).filter(Boolean));
  const joinedAt = (input.now ?? new Date()).toISOString();
  const subscribers = input.state.subscribers.map((subscriber) => ({ ...subscriber }));
  const seen = new Set(subscribers.map((subscriber) => subscriber.chatId));
  const welcomed: Subscriber[] = [];
  const added: Subscriber[] = [];
  let offset = Math.max(0, input.state.offset);

  const sorted = [...input.updates].sort((a, b) => (updateId(a) ?? 0) - (updateId(b) ?? 0));
  for (const update of sorted) {
    const id = updateId(update);
    if (id === null) continue;
    // Telegram re-delivers an update until the offset confirms it; anything
    // below the stored offset was handled by a previous run.
    if (id < offset) continue;
    offset = Math.max(offset, id + 1);
    const chatId = chatIdOf(update);
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    const subscriber: Subscriber = { chatId, name: displayName(update, chatId), joinedAt };
    subscribers.push(subscriber);
    added.push(subscriber);
    if (!known.has(chatId)) welcomed.push(subscriber);
  }

  return {
    state: { offset, subscribers },
    welcomed,
    known: added.filter((subscriber) => !welcomed.includes(subscriber)),
  };
}

export interface TelegramApiOptions extends TelegramSendOptions {
  botToken?: string;
  fetchImpl?: typeof fetch;
  dashboardUrl?: string;
}

function requireBotToken(options: TelegramApiOptions): string {
  const token = (options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

export function defaultDashboardUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.DIGEST_DASHBOARD_URL || "http://localhost:3000").replace(/\/+$/, "");
}

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
}

/**
 * One short poll: `timeout=0` returns immediately when nothing is pending, so
 * the every-five-minutes cron run stays cheap. Throws on an API/HTTP failure;
 * the caller logs it and exits non-zero, and the offset is not advanced.
 */
export async function fetchTelegramUpdates(
  offset: number,
  options: TelegramApiOptions = {},
): Promise<TelegramUpdate[]> {
  const token = requireBotToken(options);
  const doFetch = options.fetchImpl ?? fetch;
  const query = new URLSearchParams({
    offset: String(Math.max(0, offset)),
    timeout: "0",
    limit: String(MAX_UPDATES_PER_RUN),
    allowed_updates: JSON.stringify(["message"]),
  });
  const res = await doFetch(`https://api.telegram.org/bot${token}/getUpdates?${query}`, {
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) {
    // 409 means a webhook owns the bot: Telegram forbids getUpdates then.
    const hint = res.status === 409 ? " (a webhook is set — getUpdates is not allowed)" : "";
    throw new Error(`Telegram getUpdates failed: HTTP ${res.status}${hint}`);
  }
  const payload = (await res.json()) as TelegramApiResponse<TelegramUpdate[]>;
  if (payload.ok === false) {
    throw new Error(`Telegram getUpdates failed: ${payload.description ?? "unknown error"}`);
  }
  return Array.isArray(payload.result) ? payload.result : [];
}

/**
 * Send one Markdown message with the dashboard button through the shared
 * retrying sender (5 attempts, network/429/5xx only). A failed welcome is
 * logged and the loop continues with the next chat; the stored offset already
 * moved, so it is never sent twice.
 */
export async function sendTelegramMessage(
  text: string,
  chatId: string,
  options: TelegramApiOptions = {},
): Promise<boolean> {
  const token = requireBotToken(options);
  const dashboardUrl = (options.dashboardUrl ?? defaultDashboardUrl()).trim();
  const outcome = await sendTelegramMessageDetailed(text, chatId, {
    ...options,
    botToken: token,
    dashboardUrl,
    // The welcome digest carries its own dashboard link.
    appendDashboardUrl: false,
    logPrefix: "[telegram-subscribe]",
  });
  return outcome.ok;
}

const nonEmptySummary = and(isNotNull(news.summary), ne(news.summary, ""));

/**
 * The 24-hour window `daily-digest.ts` sends at 09:00: published, non-empty
 * summary, newest first. Shared so the welcome digest and the morning digest
 * can never drift apart. `platformPublishedAt` is immutable, `updatedAt` is the
 * fallback for legacy rows.
 */
export async function loadRecentDigestItems(db: Db, since: Date): Promise<DigestItem[]> {
  const rows = await db
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
        sql`${platformPublishedAtSql()} >= ${instantParam(since)}`,
        nonEmptySummary,
      ),
    )
    .orderBy(desc(platformPublishedAtSql()));
  return rows;
}

export type SubscriptionCycleStatus = "idle" | "subscribed" | "welcomed" | "partial";

export interface SubscriptionCycleResult {
  status: SubscriptionCycleStatus;
  /** Updates returned by this poll. */
  updates: number;
  /** Subscribers stored after the run. */
  subscribers: number;
  /** Subscribers added by this run. */
  added: number;
  /** New chats that received the greeting (plus the digest when there is one). */
  welcomed: number;
  failed: number;
  offset: number;
}

/**
 * Everything the cycle touches is injected, so the test drives it with a fake
 * Telegram and a fake database and never posts to the real chat.
 */
export interface SubscriptionDeps {
  loadState: () => Promise<SubscriptionState>;
  saveState: (state: SubscriptionState) => Promise<void>;
  fetchUpdates: (offset: number) => Promise<TelegramUpdate[]>;
  loadItems: (since: Date) => Promise<DigestItem[]>;
  send: (text: string, chatId: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  dashboardUrl?: string;
  log?: (message: string) => void;
}

/**
 * One cron tick: poll, store, greet. No updates means the run ends before the
 * database is touched again — that is the fast path the every-five-minutes
 * schedule relies on.
 */
export async function runSubscriptionCycle(
  deps: SubscriptionDeps,
): Promise<SubscriptionCycleResult> {
  const log = deps.log ?? ((message: string) => console.error(`[telegram-subscribe] ${message}`));
  const state = await deps.loadState();
  const updates = await deps.fetchUpdates(state.offset);
  if (updates.length === 0) {
    return {
      status: "idle",
      updates: 0,
      subscribers: state.subscribers.length,
      added: 0,
      welcomed: 0,
      failed: 0,
      offset: state.offset,
    };
  }

  const recipients = resolveRecipients(deps.env ?? process.env);
  const now = deps.now?.() ?? new Date();
  const plan = planSubscriptions({
    state,
    updates,
    knownChatIds: [...recipients.client, ...recipients.owner],
    now,
  });

  const added = plan.welcomed.length + plan.known.length;
  const offsetAdvanced = plan.state.offset !== state.offset;
  if (!offsetAdvanced && added === 0) {
    return {
      status: "idle",
      updates: updates.length,
      subscribers: state.subscribers.length,
      added: 0,
      welcomed: 0,
      failed: 0,
      offset: state.offset,
    };
  }

  // Persist the offset first: it is the idempotency key, so neither a crash nor
  // a failed send may turn into a second welcome on the next five-minute tick.
  // An update from an existing subscriber only moves the offset forward — it is
  // stored too, otherwise Telegram would re-deliver it on every tick.
  await deps.saveState(plan.state);
  log(
    `offset ${state.offset} → ${plan.state.offset}; new subscribers ${added}, to greet ${plan.welcomed.length}`,
  );

  if (plan.welcomed.length === 0) {
    return {
      status: added > 0 ? "subscribed" : "idle",
      updates: updates.length,
      subscribers: plan.state.subscribers.length,
      added,
      welcomed: 0,
      failed: 0,
      offset: plan.state.offset,
    };
  }

  // The digest is split exactly like the morning one: Telegram rejects a
  // message over 4000 characters, and a long release is not a reason to lose
  // the welcome.
  let digestParts: string[] = [];
  try {
    const since = new Date(now.getTime() - DIGEST_WINDOW_HOURS * 3600_000);
    const items = await deps.loadItems(since);
    if (items.length > 0) {
      digestParts = splitTelegramText(
        buildClientDigest(items, {
          date: now,
          dashboardUrl: deps.dashboardUrl ?? defaultDashboardUrl(deps.env ?? process.env),
        }),
      );
    }
  } catch (err) {
    // A greeting alone beats silence: a failed digest query must not cost the
    // new subscriber their first message.
    log(`today's digest is unavailable: ${(err as Error).message.slice(0, 120)}`);
  }

  let welcomed = 0;
  let failed = 0;
  for (const subscriber of plan.welcomed) {
    try {
      if ((await deps.send(WELCOME_TEXT, subscriber.chatId)) === false) {
        failed++;
        log(`→ chat ${subscriber.chatId}: welcome FAILED`);
        continue;
      }
      let digestOk = true;
      for (const part of digestParts) {
        if ((await deps.send(part, subscriber.chatId)) === false) {
          digestOk = false;
          break;
        }
      }
      if (!digestOk) {
        failed++;
        log(`→ chat ${subscriber.chatId}: digest FAILED after the welcome`);
        continue;
      }
      welcomed++;
      log(
        `→ chat ${subscriber.chatId}: welcome${digestParts.length > 0 ? " + digest" : " only"} sent`,
      );
    } catch (err) {
      // One unreachable chat never blocks the rest of the batch.
      failed++;
      log(`→ chat ${subscriber.chatId}: send error ${(err as Error).message.slice(0, 120)}`);
    }
  }

  const status: SubscriptionCycleStatus = failed > 0 ? "partial" : "welcomed";
  return {
    status,
    updates: updates.length,
    subscribers: plan.state.subscribers.length,
    added,
    welcomed,
    failed,
    offset: plan.state.offset,
  };
}

async function main(): Promise<void> {
  const db = getDb();
  const result = await runSubscriptionCycle({
    loadState: () => loadSubscriptionState(db),
    saveState: (state) => saveSubscriptionState(state, db),
    fetchUpdates: (offset) => fetchTelegramUpdates(offset),
    loadItems: (since) => loadRecentDigestItems(db, since),
    send: (text, chatId) => sendTelegramMessage(text, chatId),
  });
  // One JSON line per tick: the cron log answers "did anyone new arrive?".
  console.log(JSON.stringify(result));
  process.exit(0);
}

// Run only when executed as a script, not when a test imports the pure parts
// (planSubscriptions / parseSubscriptionState / runSubscriptionCycle).
const invokedAsScript =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[telegram-subscribe] fatal:", err);
    process.exit(1);
  });
}
