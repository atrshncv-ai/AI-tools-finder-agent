import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGigachatProvider } from "./gigachat";

// Dummy values only — never a real credential.
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const AUTH_URL = "https://auth.test-gigachat.local/api/v2/oauth";
const CHAT_URL = "https://api.test-gigachat.local/api/v1/chat/completions";
const MODEL = "GigaChat-Test";
const T0 = 1_790_000_000_000;

type PlannedResponse = {
  status?: number;
  json?: unknown;
  text?: string;
};

type RecordedCall = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

const tempDirs: string[] = [];

function envFile(values: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "gigachat-env-"));
  tempDirs.push(dir);
  const path = join(dir, ".env");
  const base: Record<string, string> = {
    GIGACHAT_CLIENT_ID: CLIENT_ID,
    GIGACHAT_CLIENT_SECRET: CLIENT_SECRET,
    GIGACHAT_AUTH_URL: AUTH_URL,
    GIGACHAT_API_URL: CHAT_URL,
    GIGACHAT_MODEL: MODEL,
  };
  const lines = Object.entries({ ...base, ...values }).map(([key, value]) => `${key}=${value}`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function stubFetch(plan: { auth?: PlannedResponse[]; chat?: PlannedResponse[] }) {
  const calls: RecordedCall[] = [];
  const authQueue = [...(plan.auth ?? [])];
  const chatQueue = [...(plan.chat ?? [])];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    calls.push({ url, headers, body: String(init?.body ?? "") });
    const queue = url === AUTH_URL ? authQueue : url === CHAT_URL ? chatQueue : null;
    if (!queue) throw new Error(`unexpected fetch url: ${url}`);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected extra request: ${url}`);
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.json,
      text: async () => next.text ?? "",
    } as unknown as Response;
  });
  return { fetchMock, calls };
}

function authResponse(token: string, expiresAt: number): PlannedResponse {
  return { json: { access_token: token, expires_at: expiresAt } };
}

function chatResponse(text: string): PlannedResponse {
  return {
    json: {
      choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("GigaChat access token", () => {
  it("fetches the OAuth token once and reuses it while it is valid", async () => {
    const { fetchMock, calls } = stubFetch({
      auth: [authResponse("token-one", T0 + 200_000)],
      chat: [chatResponse("first answer"), chatResponse("second answer")],
    });
    const provider = createGigachatProvider({
      envPath: envFile(),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => T0,
    });

    const first = await provider.completeJson({ messages: [{ role: "user", content: "one" }] });
    const second = await provider.completeJson({ messages: [{ role: "user", content: "two" }] });

    expect(first.text).toBe("first answer");
    expect(second.text).toBe("second answer");
    expect(calls.filter((call) => call.url === AUTH_URL)).toHaveLength(1);
    expect(calls.filter((call) => call.url === CHAT_URL)).toHaveLength(2);
    const chatCalls = calls.filter((call) => call.url === CHAT_URL);
    expect(chatCalls.map((call) => call.headers["Authorization"])).toEqual([
      "Bearer token-one",
      "Bearer token-one",
    ]);
  });

  it("refreshes an expired token before the chat call, not after a 401", async () => {
    let clock = T0;
    const { fetchMock, calls } = stubFetch({
      auth: [authResponse("token-old", T0 + 200_000), authResponse("token-new", T0 + 500_000)],
      chat: [chatResponse("old token answer"), chatResponse("new token answer")],
    });
    const provider = createGigachatProvider({
      envPath: envFile(),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => clock,
    });

    await provider.completeJson({ messages: [{ role: "user", content: "one" }] });
    // Past expires_at minus the 60 s safety margin: the old token is stale.
    clock = T0 + 150_000;
    const result = await provider.completeJson({ messages: [{ role: "user", content: "two" }] });

    expect(result.text).toBe("new token answer");
    expect(calls.map((call) => call.url)).toEqual([AUTH_URL, CHAT_URL, AUTH_URL, CHAT_URL]);
    const chatCalls = calls.filter((call) => call.url === CHAT_URL);
    expect(chatCalls.map((call) => call.headers["Authorization"])).toEqual([
      "Bearer token-old",
      "Bearer token-new",
    ]);
  });
});

describe("GigaChat request shape", () => {
  it("authorizes with Basic credentials and sends the OpenAI-compatible chat body", async () => {
    const { fetchMock, calls } = stubFetch({
      auth: [authResponse("token-shape", T0 + 200_000)],
      chat: [chatResponse("answer")],
    });
    const provider = createGigachatProvider({
      envPath: envFile(),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => T0,
    });
    const messages = [
      { role: "system" as const, content: "Верни JSON" },
      { role: "user" as const, content: "Текст" },
    ];

    const result = await provider.completeJson({ messages, maxTokens: 512, temperature: 0.1 });

    const [authCall, chatCall] = calls;
    expect(authCall.url).toBe(AUTH_URL);
    const expectedBasic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64");
    expect(authCall.headers["Authorization"]).toBe(`Basic ${expectedBasic}`);
    expect(authCall.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(authCall.headers["RqUID"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(new URLSearchParams(authCall.body).get("grant_type")).toBe("client_credentials");
    expect(new URLSearchParams(authCall.body).get("scope")).toBe("GIGACHAT_API_PERS");

    expect(chatCall.url).toBe(CHAT_URL);
    expect(chatCall.headers["Authorization"]).toBe("Bearer token-shape");
    expect(JSON.parse(chatCall.body)).toEqual({
      model: MODEL,
      messages,
      max_tokens: 512,
      temperature: 0.1,
    });

    expect(result).toEqual({
      text: "answer",
      provider: "gigachat",
      model: MODEL,
      usage: { inputTokens: 11, outputTokens: 7 },
    });
  });

  it("falls back to the documented defaults when optional variables are absent", async () => {
    const { fetchMock, calls } = stubFetch({
      auth: [authResponse("token-defaults", T0 + 200_000)],
      chat: [chatResponse("answer")],
    });
    const provider = createGigachatProvider({
      envPath: envFile({
        GIGACHAT_SCOPE: "GIGACHAT_API_PERS",
        GIGACHAT_MODEL: "GigaChat",
      }),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => T0,
    });

    await provider.completeJson({ messages: [{ role: "user", content: "Текст" }] });

    expect(JSON.parse(calls[1].body)).toMatchObject({
      model: "GigaChat",
      max_tokens: 1024,
      temperature: 0.3,
    });
  });
});

describe("GigaChat error classes", () => {
  async function catchError(
    plan: { auth?: PlannedResponse[]; chat?: PlannedResponse[] },
    envValues: Record<string, string> = {},
  ) {
    const { fetchMock, calls } = stubFetch(plan);
    const provider = createGigachatProvider({
      envPath: envFile(envValues),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => T0,
    });
    let error: unknown;
    try {
      await provider.completeJson({ messages: [{ role: "user", content: "Текст" }] });
    } catch (caught) {
      error = caught;
    }
    return { error, calls };
  }

  it("classifies 401/403 as config and does not retry the call", async () => {
    const { error, calls } = await catchError({
      auth: [authResponse("token", T0 + 200_000)],
      chat: [{ status: 403, text: "forbidden" }],
    });

    expect(error).toMatchObject({ name: "ProviderError", errorClass: "config", status: 403 });
    expect(calls).toHaveLength(2);
  });

  it("classifies 429 as quota", async () => {
    const { error } = await catchError({
      auth: [authResponse("token", T0 + 200_000)],
      chat: [{ status: 429, text: "too many requests" }],
    });
    expect(error).toMatchObject({ errorClass: "quota", status: 429 });
  });

  it("classifies 5xx as transient", async () => {
    const { error } = await catchError({
      auth: [authResponse("token", T0 + 200_000)],
      chat: [{ status: 503, text: "unavailable" }],
    });
    expect(error).toMatchObject({ errorClass: "transient", status: 503 });
  });

  it("classifies an unusable 400 response as content", async () => {
    const { error } = await catchError({
      auth: [authResponse("token", T0 + 200_000)],
      chat: [{ status: 400, text: "bad request" }],
    });
    expect(error).toMatchObject({ errorClass: "content", status: 400 });
  });

  it("keeps the client secret and the upstream body out of the error", async () => {
    const upstreamMarker = "upstream-response-body-marker";
    const { error } = await catchError({
      auth: [authResponse("token", T0 + 200_000)],
      chat: [{ status: 500, text: upstreamMarker }],
    });

    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(upstreamMarker);
    expect(message).not.toContain(CLIENT_SECRET);
    expect(message).not.toContain(CLIENT_ID);
    expect(message).not.toContain("token");
  });

  it("reports missing credentials as config without calling GigaChat", async () => {
    const { fetchMock } = stubFetch({ auth: [], chat: [] });
    const path = envFile({
      GIGACHAT_CLIENT_ID: "",
      GIGACHAT_CLIENT_SECRET: "",
    });
    const provider = createGigachatProvider({
      envPath: path,
      env: {},
      fetch: fetchMock as unknown as typeof fetch,
      now: () => T0,
    });

    await expect(
      provider.completeJson({ messages: [{ role: "user", content: "Текст" }] }),
    ).rejects.toMatchObject({ name: "ProviderError", errorClass: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes once when the chat call answers 401", async () => {
    const { fetchMock, calls } = stubFetch({
      auth: [authResponse("token-first", T0 + 200_000), authResponse("token-second", T0 + 400_000)],
      chat: [{ status: 401, text: "token expired" }, chatResponse("answer after refresh")],
    });
    const provider = createGigachatProvider({
      envPath: envFile(),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => T0,
    });

    const result = await provider.completeJson({ messages: [{ role: "user", content: "Текст" }] });

    expect(result.text).toBe("answer after refresh");
    expect(calls.map((call) => call.url)).toEqual([AUTH_URL, CHAT_URL, AUTH_URL, CHAT_URL]);
    expect(calls.filter((call) => call.url === CHAT_URL).map((call) => call.headers["Authorization"]))
      .toEqual(["Bearer token-first", "Bearer token-second"]);
  });
});
