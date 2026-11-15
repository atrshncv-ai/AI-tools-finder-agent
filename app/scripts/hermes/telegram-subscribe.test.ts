import { describe, expect, it } from "vitest";
import {
  parseSubscriptionState,
  planSubscriptions,
  runSubscriptionCycle,
  serializeSubscriptionState,
  WELCOME_TEXT,
  type SubscriptionDeps,
  type SubscriptionState,
  type TelegramUpdate,
} from "./telegram-subscribe";
import type { DigestItem } from "./digest-format";

/**
 * The cycle takes Telegram, the database and the digest query as dependencies,
 * so every test below speaks to fakes: no real bot token, no real `fetch`, no
 * messages in Telegram.
 */
const NOW = new Date("2026-11-15T06:00:00.000Z"); // 09:00 MSK
const DASHBOARD = "https://nauchny-agent.ru/dashboard";

const ITEM: DigestItem = {
  id: 1,
  title: "DeepSeek выпустила V4.1 Flash",
  originalUrl: "https://deepseek.example/news/v41",
  source: "rss",
  isScience: false,
  section: "ai-news",
  sphereTags: [],
  summary: "Модель отвечает вдвое быстрее и доступна в открытых весах.",
};

function update(updateId: number, chatId: number, firstName = "Аня"): TelegramUpdate {
  return { update_id: updateId, message: { chat: { id: chatId, first_name: firstName }, text: "/start" } };
}

function initialState(offset = 0): SubscriptionState {
  return { offset, subscribers: [] };
}

interface HarnessOptions {
  state?: SubscriptionState;
  updates?: TelegramUpdate[];
  items?: DigestItem[];
  env?: NodeJS.ProcessEnv;
  send?: SubscriptionDeps["send"];
}

function harness(options: HarnessOptions = {}) {
  const sent: Array<{ text: string; chatId: string }> = [];
  let saved: SubscriptionState | null = null;
  const fetches: number[] = [];
  let digestLoads = 0;

  const send: SubscriptionDeps["send"] =
    options.send ??
    (async (text, chatId) => {
      sent.push({ text, chatId });
      return true;
    });

  const deps: SubscriptionDeps = {
    loadState: async () => options.state ?? initialState(),
    saveState: async (state) => {
      saved = state;
    },
    fetchUpdates: async (offset) => {
      fetches.push(offset);
      return options.updates ?? [];
    },
    loadItems: async () => {
      digestLoads++;
      return options.items ?? [];
    },
    send,
    env: options.env ?? {},
    now: () => NOW,
    dashboardUrl: DASHBOARD,
    log: () => {},
  };

  return { deps, sent, fetches, saved: () => saved, digestLoads: () => digestLoads };
}

describe("subscription state in agent_state (JSON status)", () => {
  it("round-trips offset and subscribers", () => {
    const state: SubscriptionState = {
      offset: 12,
      subscribers: [{ chatId: "42", name: "Аня", joinedAt: NOW.toISOString() }],
    };
    expect(parseSubscriptionState(serializeSubscriptionState(state))).toEqual(state);
  });

  it("treats the schema default and a corrupt value as an empty state", () => {
    expect(parseSubscriptionState("idle")).toEqual({ offset: 0, subscribers: [] });
    expect(parseSubscriptionState("{not json")).toEqual({ offset: 0, subscribers: [] });
    expect(parseSubscriptionState(null)).toEqual({ offset: 0, subscribers: [] });
    expect(parseSubscriptionState(JSON.stringify({ offset: -5, subscribers: "nope" }))).toEqual({
      offset: 0,
      subscribers: [],
    });
  });

  it("drops duplicates already stored in the row", () => {
    const parsed = parseSubscriptionState(
      JSON.stringify({
        offset: 3,
        subscribers: [
          { chatId: 42, name: "Аня", joinedAt: NOW.toISOString() },
          { chatId: "42", name: "Дубль", joinedAt: NOW.toISOString() },
        ],
      }),
    );
    expect(parsed.subscribers).toEqual([
      { chatId: "42", name: "Аня", joinedAt: NOW.toISOString() },
    ]);
  });
});

describe("planSubscriptions: who is new and who must not be greeted", () => {
  it("advances the offset past every update and adds each chat once", () => {
    const plan = planSubscriptions({
      state: initialState(),
      updates: [
        { update_id: 5, message: { chat: { id: 7, first_name: "Ира" } } },
        update(6, 7, "Ира"),
      ],
      now: NOW,
    });
    expect(plan.state.offset).toBe(7);
    expect(plan.state.subscribers).toEqual([
      { chatId: "7", name: "Ира", joinedAt: NOW.toISOString() },
    ]);
    expect(plan.welcomed.map((subscriber) => subscriber.chatId)).toEqual(["7"]);
  });

  it("ignores an update the stored offset already confirmed", () => {
    const plan = planSubscriptions({
      state: {
        offset: 11,
        subscribers: [{ chatId: "42", name: "Аня", joinedAt: NOW.toISOString() }],
      },
      updates: [update(10, 42)],
      now: NOW,
    });
    expect(plan.state.offset).toBe(11);
    expect(plan.welcomed).toEqual([]);
    expect(plan.known).toEqual([]);
  });

  it("records a chat listed in env without adding it to the welcome batch", () => {
    const plan = planSubscriptions({
      state: initialState(),
      updates: [update(1, 999, "Владелец")],
      knownChatIds: ["999"],
      now: NOW,
    });
    expect(plan.welcomed).toEqual([]);
    expect(plan.known).toEqual([{ chatId: "999", name: "Владелец", joinedAt: NOW.toISOString() }]);
  });
});

describe("welcome cycle (no real Telegram)", () => {
  it("greets a new chat and sends today's digest right after", async () => {
    const { deps, sent, saved } = harness({
      updates: [update(10, 42)],
      items: [ITEM],
    });

    const result = await runSubscriptionCycle(deps);

    expect(result.status).toBe("welcomed");
    expect(result.added).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ text: WELCOME_TEXT, chatId: "42" });
    expect(sent[0].text.split("\n").length).toBeLessThanOrEqual(2);
    expect(sent[1].chatId).toBe("42");
    expect(sent[1].text).toContain("🌅 *Утренний дайджест научного агента*");
    expect(sent[1].text).toContain("▫️ [DeepSeek выпустила V4.1 Flash](https://deepseek.example/news/v41)");
    expect(sent[1].text).toContain(DASHBOARD);

    // State is stored with the advanced offset and the marked subscriber.
    expect(saved()).toEqual({
      offset: 11,
      subscribers: [{ chatId: "42", name: "Аня", joinedAt: NOW.toISOString() }],
    });
  });

  it("sends only the greeting when nothing was published in the last 24 hours", async () => {
    const { deps, sent } = harness({ updates: [update(3, 44)], items: [] });

    const result = await runSubscriptionCycle(deps);

    expect(result.status).toBe("welcomed");
    expect(sent).toEqual([{ text: WELCOME_TEXT, chatId: "44" }]);
  });

  it("sends nothing on a repeat run with the same offset", async () => {
    const first = harness({ updates: [update(10, 42)], items: [ITEM] });
    await runSubscriptionCycle(first.deps);
    expect(first.sent).toHaveLength(2);

    // Telegram re-delivers the same update until the offset confirms it: the
    // stored offset already covers update 10, so nothing is sent again.
    const second = harness({ state: first.saved()!, updates: [update(10, 42)], items: [ITEM] });
    const result = await runSubscriptionCycle(second.deps);
    expect(result.status).toBe("idle");
    expect(second.sent).toEqual([]);
    expect(second.saved()).toBeNull();

    // Ordinary quiet tick: the poll is the last thing that touches the offset.
    const third = harness({ state: first.saved()!, updates: [] });
    await runSubscriptionCycle(third.deps);
    expect(third.fetches).toEqual([11]);
    expect(third.sent).toEqual([]);
    expect(third.digestLoads()).toBe(0);
  });

  it("does not greet a chat that already receives the digest from env", async () => {
    const first = harness({
      updates: [update(7, 999, "Владелец")],
      env: { TELEGRAM_CLIENT_CHAT_IDS: "999" },
      items: [ITEM],
    });
    const result = await runSubscriptionCycle(first.deps);

    expect(result.status).toBe("subscribed");
    expect(result.welcomed).toBe(0);
    expect(first.sent).toEqual([]);
    expect(first.saved()?.subscribers).toEqual([
      { chatId: "999", name: "Владелец", joinedAt: NOW.toISOString() },
    ]);

    // A second message from the same chat must not produce a welcome either,
    // but the offset still moves so Telegram stops re-delivering the update.
    const second = harness({
      state: first.saved()!,
      updates: [update(8, 999, "Владелец")],
      env: { TELEGRAM_CLIENT_CHAT_IDS: "999" },
    });
    const next = await runSubscriptionCycle(second.deps);
    expect(next.status).toBe("idle");
    expect(next.offset).toBe(9);
    expect(second.sent).toEqual([]);
    expect(second.saved()).toEqual({ offset: 9, subscribers: first.saved()!.subscribers });
    expect(second.digestLoads()).toBe(0);
  });

  it("keeps greeting the other chats when one send fails", async () => {
    const delivered: string[] = [];
    const { deps, saved } = harness({
      updates: [update(1, 42), update(2, 43)],
      items: [ITEM],
      send: async (text, chatId) => {
        if (chatId === "42") throw new Error("telegram is down");
        delivered.push(`${chatId}:${text === WELCOME_TEXT ? "greeting" : "digest"}`);
        return true;
      },
    });

    const result = await runSubscriptionCycle(deps);

    expect(result.status).toBe("partial");
    expect(result.failed).toBe(1);
    expect(result.welcomed).toBe(1);
    // The second chat still got both messages, in order.
    expect(delivered).toEqual(["43:greeting", "43:digest"]);
    // Both subscribers are stored before the sends: the failed chat is not
    // welcomed twice on the next five-minute tick.
    expect(saved()?.subscribers.map((subscriber) => subscriber.chatId)).toEqual(["42", "43"]);
  });
});
